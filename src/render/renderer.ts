import { N8AOPostPass } from 'n8ao';
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { clamp } from '../core/math';
import type { GameClock, GfxApi, QualityLevel, SettingsApi } from '../core/types';
import { AIR_HAZE, installAir } from './air';
import { filmBloom, FilmGradeEffect, type FilmLook, SharpenEffect } from './film';
import { Materials } from './materials';
import { loadPhotoSurfaces } from './phototextures';
import { onPhone, presetFor, QUALITY, type QualityPreset } from './quality';
import { Atmosphere } from './sky';

/** Renderer, post-processing stack, cascaded shadows and the atmosphere. */
export class Gfx implements GfxApi {
  renderer: THREE.WebGLRenderer;
  materials: Materials;
  atmosphere: Atmosphere;
  quality: QualityLevel;
  preset: QualityPreset;
  fps = 60;
  frameMs = 16.7;
  stats = { drawCalls: 0, triangles: 0, renderScale: 1 };
  /** For tuning from the console: any fields set here replace the atmosphere's (`dev.ctx.gfx.lookOverride = { grain: 0 }`). */
  lookOverride: Partial<FilmLook> | null = null;

  private nearFade = { centre: { value: new THREE.Vector2() }, radius: { value: 0 } };
  private composer!: EffectComposer;
  private grade!: FilmGradeEffect;
  private halation: THREE.Uniform<number> | null = null;
  /** The sharpening effect where this quality level has one (`sharpen.amount.value` can be set from the console). */
  sharpen: SharpenEffect | null = null;
  private csm!: CSM;
  private frame = 0;
  private flashEl: HTMLDivElement;
  private flashTime = 0;
  private flashDuration = 0;
  private flashStrength = 0;
  private renderScale = 1;
  private scaleTimer = 0;
  private slowFrames = 0;
  private fastFrames = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private settings: SettingsApi,
    clock: GameClock,
  ) {
    this.quality = settings.data.quality;
    this.preset = presetFor(this.quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping; // done in the post stack
    this.renderer.toneMappingExposure = 1;
    this.renderer.info.autoReset = false;

    this.materials = new Materials(Math.min(this.preset.anisotropy, this.renderer.capabilities.getMaxAnisotropy()));
    this.atmosphere = new Atmosphere(scene, this.renderer, clock, QUALITY.ultra.rainDrops);

    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:5';
    document.body.appendChild(this.flashEl);

    this.build();
    window.addEventListener('resize', () => this.resize());
    settings.onChange((key) => {
      if (key === 'quality') this.setQuality(settings.data.quality);
      if (key === 'dynamicResolution' && !settings.data.dynamicResolution) {
        this.renderScale = 1;
        this.resize();
      }
    });
  }

  /** Photographic surface textures, if the asset pack is present. Call before the world is built. */
  loadTextures(onProgress?: (fraction: number) => void): Promise<number> {
    // A phone holds the 1K surface sets at half size: a quarter of the texture memory, which is what gets a
    // tab killed on a phone, and nothing it can show at its size.
    return loadPhotoSurfaces(Math.min(this.preset.anisotropy, this.renderer.capabilities.getMaxAnisotropy()), onProgress, onPhone() ? 512 : undefined);
  }

  setQuality(quality: QualityLevel) {
    this.quality = quality;
    this.preset = presetFor(quality);
    this.csm.remove();
    this.csm.dispose();
    this.composer.dispose();
    this.build();
  }

  private build() {
    const p = this.preset;
    // The filter is part of every lit material's program; the lights being rebuilt below is what makes
    // the materials pick a change up.
    this.renderer.shadowMap.type = p.shadowFilter === 'plain' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderScale = Math.max(this.renderScale, p.minScale);

    this.csm = new CSM({
      camera: this.camera,
      parent: this.scene,
      cascades: p.cascades,
      maxFar: p.shadowFar,
      mode: 'practical',
      shadowMapSize: p.shadowMapSize,
      lightDirection: new THREE.Vector3(-0.4, -0.8, 0.4).normalize(),
      lightIntensity: 4,
      lightMargin: 180,
      lightFar: 900,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    for (const light of this.csm.lights) light.shadow.normalBias = 0.35;
    // The haze and cloud shadows build on the shadow system's light chunks, which it has just (re)installed.
    installAir();
    this.materials.setAir(p.airSun, p.cloudShadows);
    this.atmosphere.setCloudSteps(p.cloudSteps);
    this.materials.setShadowSetup((m) => this.csm.setupMaterial(m));
    this.materials.setShadowTeardown((m) => this.csm.shaders.delete(m));

    const composer = (this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (p.ao !== 'off') {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = 1.9;
      ao.configuration.aoSamples = p.aoSamples;
      ao.configuration.denoiseSamples = 4;
      ao.configuration.halfRes = p.ao === 'half';
      ao.configuration.gammaCorrection = false;
      ao.configuration.color = new THREE.Color(0.02, 0.03, 0.06);
      // Left to itself the pass walks the whole scene every frame looking for transparent materials and, finding
      // any, renders the scene twice more (shadow maps included). Glass and water are fine without that.
      ao.autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      composer.addPass(ao);
    }
    // Bloom (with halation on its skirt) and tone mapping in one pass; anti-aliasing and the film grade in
    // the next, last one. Without anti-aliasing there is nothing to keep them apart, so Low has a single pass.
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const grade = (this.grade = new FilmGradeEffect(p.filmFull));
    const head: (BloomEffect | ToneMappingEffect)[] = [tone];
    this.halation = null;
    this.sharpen = null;
    if (p.bloom) {
      const bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.5, radius: 0.74 });
      this.halation = filmBloom(bloom);
      head.unshift(bloom);
    }
    if (p.smaa) {
      composer.addPass(new EffectPass(this.camera, ...head));
      const preset = p.smaaPreset === 'ultra' ? SMAAPreset.ULTRA : p.smaaPreset === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM;
      const smaa = new SMAAEffect({ preset });
      // The picture reaching it is linear light, where an edge in shade is a tiny step and goes undetected.
      // Find edges on gamma-encoded values instead, as the eye does.
      const edges = smaa.edgeDetectionMaterial;
      edges.fragmentShader = edges.fragmentShader
        .replace('void main(){', 'vec4 edgeTexel(sampler2D map,vec2 uv){vec4 c=texture2D(map,uv);return vec4(sqrt(max(c.rgb,0.0)),c.a);}\nvoid main(){')
        .replace(/texture2D\(inputBuffer,/g, 'edgeTexel(inputBuffer,');
      edges.needsUpdate = true;
      if (p.sharpen > 0) {
        // Sharpening has to read the anti-aliased picture, so it takes a pass of its own; the grade moves
        // into that pass, which keeps the grain from being sharpened.
        composer.addPass(new EffectPass(this.camera, smaa));
        this.sharpen = new SharpenEffect(p.sharpen);
        composer.addPass(new EffectPass(this.camera, this.sharpen, grade));
      } else {
        composer.addPass(new EffectPass(this.camera, smaa, grade));
      }
    } else {
      composer.addPass(new EffectPass(this.camera, ...head, grade));
    }

    this.resize();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, this.preset.pixelRatio) * this.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.csm.updateFrustums();
    this.stats.renderScale = this.renderScale;
    void this.canvas;
  }

  /**
   * A registered copy of `material` that is clipped away within the near-detail radius, for distant
   * stand-ins (far terrain, far roads, skyline boxes) that full-detail chunks replace up close.
   */
  farVariant<T extends THREE.MeshStandardMaterial>(material: T): T {
    const copy = material.clone() as T;
    const uniforms = this.nearFade;
    return this.materials.registerPatched(copy, 'far-variant', (shader) => {
      shader.uniforms.uNearCentre = uniforms.centre;
      shader.uniforms.uNearRadius = uniforms.radius;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFarXZ;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          #ifdef USE_INSTANCING
            vFarXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
          #else
            vFarXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFarXZ;\nuniform vec2 uNearCentre;\nuniform float uNearRadius;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (distance(vFarXZ, uNearCentre) < uNearRadius) discard;');
    });
  }

  /**
   * A registered copy of `material` for far-off backdrop scenery: instead of distance fog it is blended
   * a fixed amount towards the horizon colour, so it stays visible however far away it is.
   */
  backdropVariant<T extends THREE.MeshStandardMaterial>(material: T, haze: number): T {
    const copy = material.clone() as T;
    copy.fog = true;
    return this.materials.registerPatched(copy, `backdrop-${haze}`, (shader) => {
      // `haze` is what is left over the tops in clear weather. Down the flanks it thickens until the foot of
      // the range is lost in the haze lying on the plains, so the tops stand up out of the air instead of
      // the whole range being pasted on the horizon; and weather that closes the view in takes them away.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        /* glsl */ `{
          ${AIR_HAZE}
          float backHeight = cameraPosition.y + vAirRay.y;
          float backHaze = mix( 1.0, mix( ${(haze * 0.8).toFixed(3)}, 1.0, uAirLayer.w ), smoothstep( 150.0, 2100.0, backHeight ) );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, airColor, backHaze );
        }`,
      );
    });
  }

  setNearFade(x: number, z: number, radius: number) {
    this.nearFade.centre.value.set(x, z);
    this.nearFade.radius.value = radius;
  }

  get night(): number {
    return this.atmosphere.night;
  }

  get lampCount(): number {
    return this.preset.pointLights;
  }

  flash(color: number, strength: number, seconds: number) {
    this.flashEl.style.background = `#${color.toString(16).padStart(6, '0')}`;
    this.flashStrength = strength;
    this.flashDuration = this.flashTime = seconds;
  }

  /** Draw one frame. `dt` is real seconds since the previous frame. */
  render(dt: number) {
    // Smoothed frame statistics.
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.fps = 1000 / this.frameMs;

    // Dynamic resolution: drop quickly when slow, creep back up when there is headroom.
    if (this.settings.data.dynamicResolution) {
      if (dt > 1 / 50) this.slowFrames++;
      else if (dt < 1 / 58) this.fastFrames++;
      this.scaleTimer += dt;
      if (this.scaleTimer > 1.5) {
        const total = this.slowFrames + this.fastFrames || 1;
        let next = this.renderScale;
        if (this.slowFrames / total > 0.35) next -= 0.1;
        else if (this.fastFrames / total > 0.95) next += 0.05;
        next = clamp(next, this.preset.minScale, 1);
        if (Math.abs(next - this.renderScale) > 0.01) {
          this.renderScale = next;
          this.resize();
        }
        this.scaleTimer = this.slowFrames = this.fastFrames = 0;
      }
    }

    const atmo = this.atmosphere;
    atmo.update(dt, this.camera, this.preset.envInterval);
    this.materials.update(atmo.night, atmo.wetness);
    const look = this.lookOverride ? { ...atmo.look, ...this.lookOverride } : atmo.look;
    this.grade.setLook(look);
    if (this.halation) this.halation.value = look.halation;

    // Shadow-casting sun / moon.
    this.csm.lightDirection.copy(atmo.sunDir).negate();
    for (const light of this.csm.lights) {
      light.color.copy(atmo.lightColor);
      light.intensity = atmo.lightIntensity;
    }
    this.csm.update();
    // The nearest cascade is redrawn every frame; the wider ones change slowly and take turns, so at most two
    // shadow maps are drawn per frame. (A map that is not redrawn keeps the matrix it was drawn with.)
    this.frame++;
    const lights = this.csm.lights;
    for (let i = 0; i < lights.length; i++) {
      const every = i === 0 ? 1 : i === 1 ? 2 : 4;
      lights[i].shadow.autoUpdate = false;
      lights[i].shadow.needsUpdate = (this.frame + i) % every === 0;
    }

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashEl.style.opacity = String(Math.max(0, (this.flashTime / this.flashDuration) * this.flashStrength));
    }

    this.renderer.info.reset();
    this.composer.render(dt);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }
}

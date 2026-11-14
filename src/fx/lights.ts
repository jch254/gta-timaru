import * as THREE from 'three';

/**
 * Two point lights shared by every muzzle flash and explosion. They stay in the scene for good with
 * zero intensity when idle: adding or removing lights would make three.js recompile every lit
 * material, which is a visible hitch at exactly the wrong moment.
 */
export class FlashLights {
  private readonly lights: THREE.PointLight[] = [];
  private readonly left: number[] = [];
  private readonly total: number[] = [];
  private readonly peak: number[] = [];

  constructor(scene: THREE.Scene, count = 2) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffc27a, 0, 16, 2);
      light.castShadow = false;
      light.position.set(0, -1000, 0);
      scene.add(light);
      this.lights.push(light);
      this.left.push(0);
      this.total.push(1);
      this.peak.push(0);
    }
  }

  /** Current brightness of light `i` (0 when idle). */
  level(i: number): number {
    if (this.left[i] <= 0) return 0;
    const k = this.left[i] / this.total[i];
    return this.peak[i] * k * k;
  }

  /**
   * Light the surroundings for `seconds`. Takes over whichever light is dimmest; if both are busy
   * with something brighter (an explosion) the request is dropped. Returns whether it was shown.
   */
  flash(x: number, y: number, z: number, color: number, intensity: number, range: number, seconds: number): boolean {
    let pick = 0;
    let dimmest = Infinity;
    for (let i = 0; i < this.lights.length; i++) {
      const level = this.level(i);
      if (level < dimmest) {
        dimmest = level;
        pick = i;
      }
    }
    if (dimmest > intensity) return false;
    const light = this.lights[pick];
    light.position.set(x, y, z);
    light.color.setHex(color);
    light.distance = range;
    light.intensity = intensity;
    this.peak[pick] = intensity;
    this.left[pick] = this.total[pick] = Math.max(0.01, seconds);
    return true;
  }

  update(dt: number) {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.left[i] <= 0) continue;
      this.left[i] -= dt;
      this.lights[i].intensity = this.left[i] > 0 ? this.level(i) : 0;
    }
  }

  dispose() {
    for (const light of this.lights) {
      light.removeFromParent();
      light.dispose();
    }
  }
}

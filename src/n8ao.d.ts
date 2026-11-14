declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      color: Color;
      transparencyAware: boolean;
    };
    /** Scan the scene each frame for transparent materials and switch `transparencyAware` on if any are found. */
    autoDetectTransparency: boolean;
    setQualityMode(mode: string): void;
  }
}

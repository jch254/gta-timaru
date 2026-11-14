/**
 * Roster colours that are metallic paints (flake under the lacquer). Everything else is a solid enamel.
 * Kept beside the models rather than in the spec data because it is purely a matter of looks.
 */
export const METALLIC: ReadonlySet<number> = new Set([
  // Big six sedan and wagon.
  0x7d1f2b, 0x1f3d63, 0x2f5a44, 0x9aa0a4, 0xb39a5e, 0x6c7f8f, 0x4a2f22, 0x5b3b28, 0x8faabd, 0x6d1f28, 0x2d4f3a, 0x9a9d9c,
  // V8 sedan and import coupe.
  0x1b4fa8, 0x14463a, 0x4b2060, 0x8a8f96, 0xaeb4ba, 0x1b6f76, 0x38245a, 0x1f3f8f,
  // Hatch, ute, bike.
  0x86a9c6, 0xaab0b4, 0x4f9d8f, 0x8c908d, 0x1f49a8,
]);

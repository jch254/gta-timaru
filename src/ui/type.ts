/**
 * The interface's type system, for lettering drawn on a canvas (the maps, the speedometer). CSS gets the same
 * three stacks from `--th-display`, `--th-text` and `--th-reo` in src/style.css: keep the two in step.
 *
 * System faces only; nothing is downloaded. Every stack ends in faces with full macron coverage, so te reo
 * Māori names never fall back letter by letter.
 */

/** A sign-writer's Clarendon slab: town names on the map, headings. */
export const DISPLAY_FONT = `Superclarendon, Rockwell, 'Rockwell Nova', Clarendon, 'Bookman Old Style', Georgia, 'Times New Roman', serif`;

/** A condensed road-sign sans: labels, numbers, suburbs, street furniture. */
export const TEXT_FONT = `'Avenir Next Condensed', 'Roboto Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;

/** An old-style italic: te reo Māori names, landmarks, water. */
export const REO_FONT = `'Iowan Old Style', Palatino, 'Palatino Linotype', Georgia, 'Times New Roman', serif`;

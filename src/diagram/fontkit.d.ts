declare module 'fontkit' {
  export interface GlyphPath { commands: unknown[]; toSVG(): string }
  export interface Glyph { id: number; path: GlyphPath; bbox: { minX: number; minY: number; maxX: number; maxY: number } }
  export interface GlyphPosition { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }
  export interface Font { familyName: string; postscriptName: string; unitsPerEm: number; ascent: number; descent: number; hasGlyphForCodePoint(codePoint: number): boolean; layout(text: string): { glyphs: Glyph[]; positions: GlyphPosition[] } }
  export function create(bytes: Uint8Array): Font;
}

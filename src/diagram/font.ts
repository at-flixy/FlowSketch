import { create, type Font } from 'fontkit';
import { DiagramError, type FontFingerprint, type PathPrimitive, type Rect } from './types';
import { digest, round } from './utils';

/** Real font metrics and glyph outlines, shared by worker layout and every renderer. */
export class DiagramFont {
  readonly font: Font;
  constructor(bytes: Uint8Array, readonly fingerprint: FontFingerprint, decoded?: Font) { this.font = decoded ?? create(bytes); }

  measure(text: string, size: number): number {
    for (const character of text) {
      if (!this.font.hasGlyphForCodePoint(character.codePointAt(0)!)) throw new DiagramError('FONT_GLYPH_MISSING', `Шрифт не содержит символ «${character}».`);
    }
    return this.font.layout(text).positions.reduce((sum, position) => sum + position.xAdvance, 0) * size / this.font.unitsPerEm;
  }

  wrap(text: string, maxWidth: number, size: number): string[] {
    const lines: string[] = [];
    const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\t', '    ');
    for (const paragraph of normalized.split('\n')) {
      let current = '';
      for (const token of paragraph.match(/\S+\s*/gu) ?? ['']) {
        const trimmed = token.trimEnd();
        if (this.measure(current + trimmed, size) <= maxWidth) { current += token; continue; }
        if (current.trim()) { lines.push(current.trimEnd()); current = ''; }
        if (this.measure(trimmed, size) <= maxWidth) { current = token; continue; }
        // Only an overlong unspaced token is broken inside the token.
        for (const character of trimmed) {
          if (current && this.measure(current + character, size) > maxWidth) { lines.push(current); current = ''; }
          current += character;
        }
        current += ' ';
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }

  outlines(text: string, centerX: number, centerY: number, size: number, color: string, owner: string): { paths: PathPrimitive[]; ink: Rect[] } {
    const width = this.measure(text, size);
    const run = this.font.layout(text);
    const scale = size / this.font.unitsPerEm;
    const baseline = centerY + (this.font.ascent + this.font.descent) * scale / 2;
    let pen = centerX - width / 2;
    const paths: PathPrimitive[] = [], ink: Rect[] = [];
    run.glyphs.forEach((glyph, index) => {
      const position = run.positions[index];
      const x = pen + position.xOffset * scale, y = baseline - position.yOffset * scale;
      if (glyph.path.commands.length) {
        paths.push({ d: glyph.path.toSVG(), transform: [scale, 0, 0, -scale, round(x), round(y)], fill: color, role: 'glyph', owner });
        ink.push({ x: x + glyph.bbox.minX * scale, y: y - glyph.bbox.maxY * scale, width: (glyph.bbox.maxX - glyph.bbox.minX) * scale, height: (glyph.bbox.maxY - glyph.bbox.minY) * scale });
      }
      pen += position.xAdvance * scale;
    });
    return { paths, ink };
  }
}

export async function createDiagramFont(bytes: Uint8Array): Promise<DiagramFont> {
  const font = create(bytes);
  return new DiagramFont(bytes, { family: font.familyName, postscriptName: font.postscriptName, unitsPerEm: font.unitsPerEm, sha256: await digest(bytes) }, font);
}

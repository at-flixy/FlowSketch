import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DiagramStyle, SemanticGraph } from '../types';
import NodeELK from 'elkjs/lib/elk.bundled.js';
import { createScene as createBrowserScene, sceneFingerprint, type SceneContext } from './engine';
import { createDiagramFont, type DiagramFont } from './font';
import { validateScene } from './geometry';
import { defaultStyle, normalizeStyle, templates } from './styles';
import { pngDimensions, sceneSvg } from './export';
import { fitViewport, zoomAt } from './viewport';
import { digest } from './utils';

let font: DiagramFont;
const graph: SemanticGraph = JSON.parse(readFileSync(new URL('../../spikes/clang/sumOdd.graph.json', import.meta.url), 'utf8'));
const context = { requestId: 'test', modelRevision: 7, styleRevision: 3 };
const createScene = (graph: SemanticGraph, style: Partial<DiagramStyle>, font: DiagramFont, context: SceneContext) => createBrowserScene(graph, style, font, context, new NodeELK());
beforeAll(async () => { font = await createDiagramFont(new Uint8Array(readFileSync(new URL('./fonts/LiberationSans-Regular.ttf', import.meta.url)))); });

describe('Browser-independent scene core', () => {
  it('preserves real Clang graph/source ranges and every transition across all four styles', async () => {
    const original = structuredClone(graph), originalDigest = await digest(graph);
    const digests = new Set<string>();
    for (const preset of templates) {
      const scene = await createScene(graph, preset.style, font, context);
      expect(scene.status, JSON.stringify(scene.diagnostics)).toBe('ready');
      expect(scene.graphDigest).toBe(originalDigest);
      expect(scene.nodes.length).toBe(graph.nodes.length); expect(scene.edges.length).toBe(graph.edges.length);
      for (const node of graph.nodes) { const actual = scene.nodes.find(n => n.id === node.id)!; expect(actual.sourceRange).toEqual(node.sourceRange); expect(actual.originalText).toBe(node.originalText); }
      for (const edge of graph.edges) { const actual = scene.edges.find(e => e.id === edge.id)!; expect({ ...actual, points: undefined, labelBox: undefined }).toEqual({ ...edge, points: undefined, labelBox: undefined }); }
      digests.add(scene.sceneDigest);
    }
    expect(graph).toEqual(original); expect(digests.size).toBe(4);
  });

  it('12/24 fonts remeasure geometry rather than scaling a stale scene', async () => {
    const small = await createScene(graph, { ...defaultStyle, fontSize: 12 }, font, context);
    const large = await createScene(graph, { ...defaultStyle, fontSize: 24 }, font, context);
    expect(small.status).toBe('ready'); expect(large.status, JSON.stringify(large.diagnostics)).toBe('ready');
    expect(large.sceneDigest).not.toBe(small.sceneDigest); expect(large.graphDigest).toBe(small.graphDigest);
    expect(large.height).toBeGreaterThan(small.height); expect(large.font.sha256).toBe(small.font.sha256);
  });

  it('retains geometry and entry order for all 21 existing native Clang regression graphs', async () => {
    const audit: { results: { id: string; graphFile: string }[] } = JSON.parse(readFileSync(new URL('../../tests/fixtures/clang/index.json', import.meta.url), 'utf8'));
    expect(audit.results).toHaveLength(21);
    for (const item of audit.results) {
      const input: SemanticGraph = JSON.parse(readFileSync(new URL(`../../${item.graphFile.replaceAll('\\', '/')}`, import.meta.url), 'utf8'));
      const original = structuredClone(input), scene = await createScene(input, defaultStyle, font, context);
      expect(scene.status, `${item.id}: ${JSON.stringify(scene.diagnostics)}`).toBe('ready');
      expect(input).toEqual(original);
      expect(scene.nodes).toHaveLength(input.nodes.length); expect(scene.edges).toHaveLength(input.edges.length);
      for (const edge of input.edges) {
        const actual = scene.edges.find(candidate => candidate.id === edge.id)!;
        expect({ ...actual, points: undefined, labelBox: undefined }, `${item.id}: ${edge.id}`).toEqual({ ...edge, points: undefined, labelBox: undefined });
      }
      const entry = scene.nodes.find(node => node.id === input.entryId);
      if (entry) expect(entry.y, `${item.id}: entry topmost`).toBe(Math.min(...scene.nodes.map(node => node.y)));
      expect(validateScene(scene), item.id).toEqual([]);
    }
  }, 30_000);

  it('is deterministic across different transport requests and retains provenance', async () => {
    const a = await createScene(graph, defaultStyle, font, context);
    const b = await createScene(graph, defaultStyle, font, { ...context, requestId: 'later', modelRevision: 8 });
    expect(a.sceneDigest).toBe(b.sceneDigest); expect(await sceneFingerprint(a)).toBe(a.sceneDigest);
    expect(b.modelRevision).toBe(8); expect(b.requestId).toBe('later');
    const svg = sceneSvg(a);
    expect(svg).toContain('Начало'); expect(svg).toContain(a.sceneDigest); expect(svg).not.toContain('foreignObject'); expect(svg).not.toContain('font-family=');
    expect(svg.match(/<path /g)?.length).toBe(a.primitives.length);
  });

  it('rejects text in a diamond corner and a detached or unrelated crossing edge', async () => {
    const scene = await createScene(graph, defaultStyle, font, context), broken = structuredClone(scene);
    const diamond = broken.nodes.find(node => node.kind === 'decision')!;
    diamond.ink = [{ x: diamond.x + 2, y: diamond.y + 2, width: 8, height: 8 }];
    expect(validateScene(broken).some(error => error.code === 'TEXT_OUTSIDE_SHAPE')).toBe(true);
    const edge = broken.edges[0], other = broken.nodes.find(node => node.id !== edge.source && node.id !== edge.target)!;
    edge.points = [{ x: other.x - 5, y: other.y + other.height / 2 }, { x: other.x + other.width + 5, y: other.y + other.height / 2 }];
    expect(validateScene(broken).some(error => error.code === 'EDGE_THROUGH_SHAPE')).toBe(true);
    expect(validateScene(broken).some(error => error.code === 'EDGE_PORT_DETACHED')).toBe(true);
    expect(() => sceneSvg(broken)).toThrow();
  });

  it('keeps continue semantics with an independent feedback hint, not all continue edges', async () => {
    const whileGraph: SemanticGraph = { id: 'while', title: 'while', nodes: [{ id: 's', kind: 'terminator', label: 'Начало' }, { id: 'c', kind: 'decision', label: 'i < n' }, { id: 'b', kind: 'process', label: 'continue;' }, { id: 'z', kind: 'terminator', label: 'Конец' }], edges: [{ id: 'a', source: 's', target: 'c', role: 'next' }, { id: 'b', source: 'c', target: 'b', role: 'true', label: 'Да' }, { id: 'c', source: 'b', target: 'c', role: 'continue', layoutHint: 'back' }, { id: 'd', source: 'c', target: 'z', role: 'false', label: 'Нет' }] };
    const scene = await createScene(whileGraph, defaultStyle, font, context);
    expect(scene.status, JSON.stringify(scene.diagnostics)).toBe('ready');
    expect(scene.edges.find(edge => edge.id === 'c')!.role).toBe('continue');
    expect(scene.nodes.find(node => node.id === 'c')!.y).toBeLessThan(scene.nodes.find(node => node.id === 'b')!.y);
    const incorrect = structuredClone(whileGraph); delete incorrect.edges[2].layoutHint;
    await expect(createScene(incorrect, defaultStyle, font, context)).rejects.toMatchObject({ code: 'LAYOUT_CYCLE_ROLE_REQUIRED' });
  });

  it('wraps long Russian text, tabs, CRLF and symbols using real font metrics', () => {
    const text = 'Проверить количество переменнаяСОченьДлиннымНепрерывнымИдентификаторомДляПереноса Ёж № 123 < > & "текст"';
    const lines = font.wrap(text, 140, 14);
    expect(lines.every(line => font.measure(line, 14) <= 140.001)).toBe(true);
    expect(lines.join('').replaceAll(' ', '')).toBe(text.replaceAll(' ', ''));
    expect(font.wrap('int\tx;\r\nreturn x;', 200, 14)).toEqual(font.wrap('int    x;\nreturn x;', 200, 14));
    expect(() => font.measure('😀', 14)).toThrow();
  });

  it('validates palettes/font bounds and raster caps before allocation', () => {
    expect(() => normalizeStyle({ fontSize: 11 })).toThrow(); expect(() => normalizeStyle({ strokeWidth: 5 })).toThrow();
    expect(() => normalizeStyle({ lineColor: 'url(https://example.org)' })).toThrow();
    expect(pngDimensions({ width: 600, height: 1000 } as never, 3)).toEqual({ width: 1800, height: 3000 });
    expect(() => pngDimensions({ width: 15899, height: 4776 } as never, 1)).toThrow();
    expect(() => pngDimensions({ width: 16385, height: 200 } as never, 1)).toThrow();
  });

  it('zoom keeps the pointer anchor fixed; fit respects view dimensions and bounds', () => {
    const before = { x: 42, y: 17, scale: .8 }, anchor = { x: 300, y: 200 }, after = zoomAt(before, 1.6, anchor);
    expect((anchor.x - before.x) / before.scale).toBeCloseTo((anchor.x - after.x) / after.scale);
    expect((anchor.y - before.y) / before.scale).toBeCloseTo((anchor.y - after.y) / after.scale);
    expect(zoomAt(before, 9, anchor).scale).toBe(4);
    const fit = fitViewport({ width: 574, height: 1006 }, 900, 700);
    expect(fit.scale).toBeGreaterThanOrEqual(.1); expect(fit.scale).toBeLessThanOrEqual(1); expect(fit.y).toBeGreaterThanOrEqual(24);
  });
});

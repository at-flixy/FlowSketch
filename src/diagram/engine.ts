import ELK, { type ElkNode, type ElkExtendedEdge, type ELK as ElkEngine } from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { DiagramStyle, GraphEdge, SemanticGraph } from '../types';
import { DiagramFont } from './font';
import { corners, outlinePath, overlaps, polygonPath, rectPath, segmentRect, shapePolygon, validateScene } from './geometry';
import { normalizeStyle } from './styles';
import { DiagramError, type DiagramScene, type Point, type Rect, type SceneEdge, type SceneNode, type PathPrimitive } from './types';
import { digest, round } from './utils';

type PortSide = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST';
export interface SceneContext { requestId: string; modelRevision: number | string; styleRevision: number }
export const isFeedback = (edge: GraphEdge) => edge.role === 'back' || edge.layoutHint === 'back';
const kinds = new Set(['terminator', 'process', 'decision', 'io', 'call', 'connector']);

function measureNodes(graph: SemanticGraph, font: DiagramFont, size: number): SceneNode[] {
  const lineHeight = size * 1.36, padding = 12;
  return graph.nodes.map(node => {
    if (!kinds.has(node.kind)) throw new DiagramError('NODE_KIND_UNSUPPORTED', `Неизвестный тип фигуры: ${node.kind}.`);
    const lines = font.wrap(node.label, node.kind === 'decision' ? 190 : 220, size);
    const textWidth = Math.max(1, ...lines.map(line => font.measure(line, size))), textHeight = lines.length * lineHeight;
    let width = Math.max(160, textWidth + padding * 2), height = Math.max(48, textHeight + padding * 2);
    if (node.kind === 'decision') { width = Math.max(180, 2 * (textWidth + padding * 2)); height = Math.max(100, 2 * (textHeight + padding * 2)); }
    if (node.kind === 'io') width += 48;
    if (node.kind === 'connector') { width = Math.max(width, height); height = width; }
    return { ...node, lines, textWidth, textHeight, width: round(width), height: round(height), x: 0, y: 0, polygon: [], outlinePath: '', ink: [] };
  });
}

function forwardOrder(nodes: SceneNode[], edges: GraphEdge[]): SceneNode[] {
  const degree = new Map(nodes.map(node => [node.id, 0])), order = new Map(nodes.map((node, index) => [node.id, index]));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const edge of edges) if (!isFeedback(edge)) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  const queue = nodes.filter(node => degree.get(node.id) === 0), result: SceneNode[] = [];
  while (queue.length) {
    queue.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const node = queue.shift()!;
    result.push(node);
    for (const edge of edges) if (!isFeedback(edge) && edge.source === node.id) {
      degree.set(edge.target, degree.get(edge.target)! - 1);
      if (degree.get(edge.target) === 0) queue.push(byId.get(edge.target)!);
    }
  }
  if (result.length !== nodes.length) throw new DiagramError('LAYOUT_CYCLE_ROLE_REQUIRED', 'Для обратного перехода цикла требуется явная метка анализатора.');
  return result;
}

function sideFor(edge: GraphEdge, source: boolean, index: number): PortSide {
  if (isFeedback(edge)) return 'WEST';
  if (!source) return 'NORTH';
  if (edge.role === 'false') return 'EAST';
  if (edge.role === 'default') return 'WEST';
  if (edge.role === 'case') return index % 2 ? 'EAST' : 'SOUTH';
  return 'SOUTH';
}

function elkInput(graph: SemanticGraph, nodes: SceneNode[], font: DiagramFont, labelSize: number): ElkNode {
  const ids = new Set(nodes.map(node => node.id));
  const ports = new Map<string, { node: string; side: PortSide }>();
  const edges: ElkExtendedEdge[] = graph.edges.map((edge, index) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new DiagramError('EDGE_TARGET_MISSING', `Неизвестная фигура у связи ${edge.id}.`);
    const sourceSide = sideFor(edge, true, index), targetSide = sideFor(edge, false, index);
    const sourcePort = `${edge.source}:${sourceSide}`, targetPort = `${edge.target}:${targetSide}`;
    ports.set(sourcePort, { node: edge.source, side: sourceSide }); ports.set(targetPort, { node: edge.target, side: targetSide });
    return { id: edge.id, sources: [sourcePort], targets: [targetPort], layoutOptions: { 'elk.layered.priority.direction': isFeedback(edge) ? '0' : '10' },
      ...(edge.label ? { labels: [{ id: `${edge.id}:label`, text: edge.label, width: font.measure(edge.label, labelSize) + 12, height: labelSize + 10 }] } : {}) };
  });
  return { id: graph.id,
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.randomSeed': '1',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]', 'elk.spacing.nodeNode': '48', 'elk.spacing.edgeNode': '18', 'elk.spacing.edgeEdge': '12',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56', 'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.layered.feedbackEdges': 'true', 'elk.layered.mergeEdges': 'false', 'elk.layered.edgeLabels.sideSelection': 'ALWAYS_DOWN',
    },
    children: forwardOrder(nodes, graph.edges).map(node => ({ id: node.id, width: node.width, height: node.height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [...ports.entries()].filter(([, port]) => port.node === node.id).map(([id, { side }]) => ({ id, width: 0, height: 0,
        x: side === 'WEST' ? 0 : side === 'EAST' ? node.width : node.width / 2,
        y: side === 'NORTH' ? 0 : side === 'SOUTH' ? node.height : node.height / 2,
        layoutOptions: { 'elk.port.side': side },
      })),
    })), edges,
  };
}

function placeLabels(scene: DiagramScene, font: DiagramFont, labelSize: number, elkLabels: Map<string, Rect>): void {
  const occupied: Rect[] = [];
  for (const edge of scene.edges) {
    if (!edge.label) continue;
    const width = font.measure(edge.label, labelSize) + 12, height = labelSize + 10, candidates: Rect[] = [];
    const initial = elkLabels.get(edge.id);
    if (initial) candidates.push({ ...initial, width, height });
    const segments = edge.points.slice(1).map((b, index) => { const a = edge.points[index]; return { a, b, length: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) }; }).sort((a, b) => b.length - a.length);
    for (const { a, b } of segments) for (const ratio of [.5, .25, .75]) {
      const x = a.x + (b.x - a.x) * ratio, y = a.y + (b.y - a.y) * ratio;
      if (Math.abs(a.y - b.y) < .01) candidates.push({ x: x - width / 2, y: y - height - 5, width, height }, { x: x - width / 2, y: y + 5, width, height });
      else candidates.push({ x: x + 7, y: y - height / 2, width, height }, { x: x - width - 7, y: y - height / 2, width, height });
    }
    edge.labelBox = candidates.find(rect => !scene.nodes.some(node => overlaps(rect, node, 6)) && !occupied.some(other => overlaps(rect, other, 4)) && !scene.edges.some(other => other.points.slice(1).some((b, index) => segmentRect(other.points[index], b, rect))));
    if (edge.labelBox) occupied.push(edge.labelBox);
  }
}

function normalizeBounds(scene: DiagramScene): void {
  const points = scene.nodes.flatMap(corners).concat(scene.edges.flatMap(edge => edge.points)).concat(scene.edges.flatMap(edge => edge.labelBox ? corners(edge.labelBox) : []));
  const minX = Math.min(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y));
  const dx = 24 - minX, dy = 24 - minY;
  scene.width = Math.ceil(Math.max(...points.map(point => point.x)) - minX + 48); scene.height = Math.ceil(Math.max(...points.map(point => point.y)) - minY + 48);
  for (const node of scene.nodes) { node.x = round(node.x + dx); node.y = round(node.y + dy); node.polygon = shapePolygon(node); node.outlinePath = outlinePath(node); }
  for (const edge of scene.edges) {
    edge.points = edge.points.map(point => ({ x: round(point.x + dx), y: round(point.y + dy) }));
    if (edge.labelBox) { edge.labelBox.x = round(edge.labelBox.x + dx); edge.labelBox.y = round(edge.labelBox.y + dy); }
  }
}

function buildPrimitives(scene: DiagramScene, font: DiagramFont, labelSize: number): PathPrimitive[] {
  const paths: PathPrimitive[] = [], { style } = scene;
  for (const edge of scene.edges) {
    paths.push({ d: edge.points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' '), stroke: style.lineColor, strokeWidth: style.strokeWidth, role: 'edge', owner: edge.id });
    const end = edge.points.at(-1), previous = edge.points.at(-2);
    if (end && previous) {
      const angle = Math.atan2(end.y - previous.y, end.x - previous.x), length = Math.max(8, style.strokeWidth * 3), half = Math.max(3.5, style.strokeWidth * 1.8);
      const arrow: Point[] = [end, { x: end.x - length * Math.cos(angle) + half * Math.sin(angle), y: end.y - length * Math.sin(angle) - half * Math.cos(angle) }, { x: end.x - length * Math.cos(angle) - half * Math.sin(angle), y: end.y - length * Math.sin(angle) + half * Math.cos(angle) }];
      paths.push({ d: polygonPath(arrow), fill: style.lineColor, role: 'arrow', owner: edge.id });
    }
  }
  for (const node of scene.nodes) {
    paths.push({ d: node.outlinePath, fill: node.kind === 'decision' ? style.decisionFill : node.kind === 'terminator' ? style.terminalFill : style.nodeFill, stroke: style.lineColor, strokeWidth: style.strokeWidth, role: 'node', owner: node.id });
    if (node.kind === 'call') for (const x of [node.x + 8, node.x + node.width - 8]) paths.push({ d: `M${x} ${node.y}V${node.y + node.height}`, stroke: style.lineColor, strokeWidth: style.strokeWidth, role: 'call-decoration', owner: node.id });
  }
  for (const node of scene.nodes) node.lines.forEach((line, index) => {
    const shaped = font.outlines(line, node.x + node.width / 2, node.y + node.height / 2 + (index - (node.lines.length - 1) / 2) * style.fontSize * 1.36, style.fontSize, style.textColor, node.id);
    node.ink.push(...shaped.ink); paths.push(...shaped.paths);
  });
  for (const edge of scene.edges) if (edge.label && edge.labelBox) {
    paths.push({ d: rectPath(edge.labelBox), fill: style.background, role: 'label-background', owner: edge.id });
    paths.push(...font.outlines(edge.label, edge.labelBox.x + edge.labelBox.width / 2, edge.labelBox.y + edge.labelBox.height / 2, labelSize, style.textColor, edge.id).paths);
  }
  return paths;
}

export async function sceneFingerprint(scene: DiagramScene): Promise<string> {
  const { requestId: _request, modelRevision: _model, styleRevision: _style, timings: _timing, sceneDigest: _digest, ...geometry } = scene;
  return digest(geometry);
}

/** Runs in the local worker; no filesystem, Node API or source execution. */
export async function createScene(graph: SemanticGraph, inputStyle: Partial<DiagramStyle>, font: DiagramFont, context: SceneContext, injectedEngine?: ElkEngine, workerUrl = elkWorkerUrl): Promise<DiagramScene> {
  const start = performance.now(), style = normalizeStyle(inputStyle);
  if (!graph.id || !graph.nodes.length || graph.nodes.length > 500 || graph.edges.length > 1000) throw new DiagramError('GRAPH_LIMIT', 'Схема должна содержать от 1 до 500 блоков и не более 1000 связей.');
  if (new Set(graph.nodes.map(node => node.id)).size !== graph.nodes.length || new Set(graph.edges.map(edge => edge.id)).size !== graph.edges.length) throw new DiagramError('GRAPH_DUPLICATE_ID', 'Идентификаторы блоков или связей повторяются.');
  const model = structuredClone(graph), measured = measureNodes(model, font, style.fontSize), measurementMs = performance.now() - start;
  const labelSize = Math.max(12, style.fontSize - 2);
  // The bundled ELK fallback is for a window/Node scope. Inside a Worker its
  // GWT initialization installs self.onmessage instead of exporting Worker.
  // Use the API with an explicit, locally packaged classic GWT worker instead.
  let reportWorkerFailure: (error: Error) => void = () => {};
  const workerFailure = new Promise<never>((_, reject) => { reportWorkerFailure = reject; });
  const policyViolation = (event: SecurityPolicyViolationEvent) => reportWorkerFailure(new DiagramError('ELK_WORKER_CSP', `Политика приложения заблокировала движок раскладки (${event.violatedDirective}).`));
  const engine = injectedEngine ?? new ELK({ workerFactory: () => {
    const worker = new Worker(workerUrl);
    worker.addEventListener('error', event => reportWorkerFailure(new DiagramError('ELK_WORKER_FAILURE', `Ошибка локального движка раскладки: ${event.message || 'не удалось загрузить Worker'}.`)));
    worker.addEventListener('messageerror', () => reportWorkerFailure(new DiagramError('ELK_WORKER_MESSAGE', 'Не удалось прочитать ответ локального движка раскладки.')));
    return worker;
  } });
  if (!injectedEngine) self.addEventListener('securitypolicyviolation', policyViolation);
  let output: ElkNode;
  try { output = await Promise.race([engine.layout(elkInput(model, measured, font, labelSize)), workerFailure]); }
  finally { if (!injectedEngine) { self.removeEventListener('securitypolicyviolation', policyViolation); engine.terminateWorker(); } }
  const measuredById = new Map(measured.map(node => [node.id, node])), originalEdges = new Map(model.edges.map(edge => [edge.id, edge]));
  const scene: DiagramScene = {
    schemaVersion: 1, id: graph.id, title: graph.title, width: 0, height: 0, status: 'rejected',
    nodes: output.children!.map(node => ({ ...measuredById.get(node.id)!, x: round(node.x!), y: round(node.y!) })),
    edges: (output.edges ?? []).map(edge => ({ ...originalEdges.get(edge.id)!, points: ((edge as ElkExtendedEdge).sections ?? []).flatMap(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]).map(point => ({ x: round(point.x), y: round(point.y) })) })),
    primitives: [], diagnostics: [], font: font.fingerprint, fontSize: style.fontSize, style,
    graphDigest: await digest(model), styleDigest: await digest(style), sceneDigest: '', ...context,
    timings: { measurementMs: round(measurementMs), totalMs: 0 },
  };
  const labels = new Map<string, Rect>();
  for (const edge of output.edges ?? []) if (edge.labels?.[0]) labels.set(edge.id, { x: edge.labels[0].x!, y: edge.labels[0].y!, width: edge.labels[0].width!, height: edge.labels[0].height! });
  placeLabels(scene, font, labelSize, labels); normalizeBounds(scene); scene.primitives = buildPrimitives(scene, font, labelSize);
  scene.diagnostics = validateScene(scene); scene.status = scene.diagnostics.length ? 'rejected' : 'ready';
  scene.sceneDigest = await sceneFingerprint(scene); scene.timings.totalMs = round(performance.now() - start);
  return scene;
}

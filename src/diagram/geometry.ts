import type { DiagramScene, GeometryDiagnostic, Point, Rect, SceneNode } from './types';
import { round } from './utils';
const EPS = .01;
export const corners = (rect: Rect): Point[] => [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
export const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.width + gap - EPS && a.x + a.width + gap > b.x + EPS && a.y < b.y + b.height + gap - EPS && a.y + a.height + gap > b.y + EPS;
export const polygonPath = (polygon: Point[]) => polygon.map((point, index) => `${index ? 'L' : 'M'}${round(point.x)} ${round(point.y)}`).join(' ') + 'Z';
export const rectPath = (rect: Rect) => polygonPath(corners(rect));

export function shapePolygon(node: SceneNode): Point[] {
  const { x, y, width: w, height: h } = node;
  if (node.kind === 'decision') return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
  if (node.kind === 'io') return [{ x: x + 24, y }, { x: x + w, y }, { x: x + w - 24, y: y + h }, { x, y: y + h }];
  if (node.kind === 'terminator' || node.kind === 'connector') {
    const radius = node.kind === 'connector' ? w / 2 : h / 2, left = x + radius, right = x + w - radius;
    const polygon: Point[] = [];
    for (let index = 0; index <= 24; index++) { const angle = -Math.PI / 2 + index * Math.PI / 24; polygon.push({ x: right + radius * Math.cos(angle), y: y + h / 2 + radius * Math.sin(angle) }); }
    for (let index = 0; index <= 24; index++) { const angle = Math.PI / 2 + index * Math.PI / 24; polygon.push({ x: left + radius * Math.cos(angle), y: y + h / 2 + radius * Math.sin(angle) }); }
    return polygon;
  }
  return corners(node);
}

export function outlinePath(node: SceneNode): string {
  if (node.kind !== 'terminator' && node.kind !== 'connector') return polygonPath(node.polygon);
  const { x, y, width: w, height: h } = node, r = h / 2;
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

export function pointIn(point: Point, polygon: Point[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const value = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(value) < EPS) continue;
    if (sign && Math.sign(value) !== sign) return false;
    sign = Math.sign(value);
  }
  return true;
}

export function segmentRect(a: Point, b: Point, rect: Rect): boolean {
  if (Math.abs(a.x - b.x) < EPS) return a.x > rect.x - EPS && a.x < rect.x + rect.width + EPS && Math.max(a.y, b.y) > rect.y + EPS && Math.min(a.y, b.y) < rect.y + rect.height - EPS;
  if (Math.abs(a.y - b.y) < EPS) return a.y > rect.y - EPS && a.y < rect.y + rect.height + EPS && Math.max(a.x, b.x) > rect.x + EPS && Math.min(a.x, b.x) < rect.x + rect.width - EPS;
  return true;
}

export function segmentPolygon(a: Point, b: Point, polygon: Point[]): boolean {
  if (pointIn(a, polygon) || pointIn(b, polygon)) return true;
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let index = 0; index < polygon.length; index++) {
    const c = polygon[index], d = polygon[(index + 1) % polygon.length];
    if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + EPS && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + EPS) return true;
  }
  return false;
}

function distanceToPolygon(point: Point, polygon: Point[]): number {
  return Math.min(...polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y;
    const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy);
  }));
}

export function validateScene(scene: DiagramScene): GeometryDiagnostic[] {
  const errors: GeometryDiagnostic[] = [], byId = new Map(scene.nodes.map(node => [node.id, node]));
  for (let index = 0; index < scene.nodes.length; index++) {
    const node = scene.nodes[index];
    for (const other of scene.nodes.slice(index + 1)) if (overlaps(node, other)) errors.push({ code: 'NODE_OVERLAP', message: 'Фигуры перекрываются.', nodes: [node.id, other.id] });
    if (node.ink.some(rect => !corners(rect).every(point => pointIn(point, node.polygon)))) errors.push({ code: 'TEXT_OUTSIDE_SHAPE', message: 'Текст выходит за внутреннюю область фигуры.', nodeId: node.id });
  }
  for (const edge of scene.edges) {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target || edge.points.length < 2) { errors.push({ code: 'EDGE_ROUTE_MISSING', message: 'Отсутствует маршрут связи.', edgeId: edge.id }); continue; }
    if (distanceToPolygon(edge.points[0], source.polygon) > .05 || distanceToPolygon(edge.points.at(-1)!, target.polygon) > .05) errors.push({ code: 'EDGE_PORT_DETACHED', message: 'Стрелка не соединена с границей фигуры.', edgeId: edge.id });
    if (edge.role !== 'back' && edge.layoutHint !== 'back' && target.y + target.height / 2 < source.y + source.height / 2 - EPS) errors.push({ code: 'FORWARD_EDGE_UPWARD', message: 'Прямой переход направлен против порядка программы.', edgeId: edge.id });
    edge.points.slice(1).forEach((b, index) => {
      const a = edge.points[index];
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) errors.push({ code: 'EDGE_NOT_ORTHOGONAL', message: 'Маршрут стрелки не ортогонален.', edgeId: edge.id });
      for (const node of scene.nodes) if (node.id !== edge.source && node.id !== edge.target && segmentPolygon(a, b, node.polygon)) errors.push({ code: 'EDGE_THROUGH_SHAPE', message: 'Стрелка проходит через постороннюю фигуру.', edgeId: edge.id, nodeId: node.id });
    });
    if (edge.label && !edge.labelBox) errors.push({ code: 'EDGE_LABEL_MISSING', message: 'Не удалось разместить подпись перехода.', edgeId: edge.id });
    if (edge.labelBox) {
      if (scene.nodes.some(node => overlaps(edge.labelBox!, node))) errors.push({ code: 'LABEL_OVERLAPS_SHAPE', message: 'Подпись перекрывает фигуру.', edgeId: edge.id });
      if (scene.edges.some(other => other.id < edge.id && other.labelBox && overlaps(edge.labelBox!, other.labelBox))) errors.push({ code: 'LABEL_OVERLAP', message: 'Подписи переходов перекрываются.', edgeId: edge.id });
      if (scene.edges.some(other => other.points.slice(1).some((b, index) => segmentRect(other.points[index], b, edge.labelBox!)))) errors.push({ code: 'EDGE_THROUGH_LABEL', message: 'Стрелка проходит через подпись.', edgeId: edge.id });
    }
  }
  return errors;
}

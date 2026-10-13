import type { DiagramStyle, GraphEdge, GraphNode } from '../types';
export type { DiagramStyle, SemanticGraph } from '../types';

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface FontFingerprint { family: string; postscriptName: string; sha256: string; unitsPerEm: number }
export interface GeometryDiagnostic { code: string; message: string; nodeId?: string; edgeId?: string; nodes?: string[]; edges?: string[] }
export interface SceneNode extends GraphNode, Rect {
  lines: string[];
  textWidth: number;
  textHeight: number;
  polygon: Point[];
  outlinePath: string;
  ink: Rect[];
}
export interface SceneEdge extends GraphEdge {
  points: Point[];
  labelBox?: Rect;
}
export interface PathPrimitive {
  d: string;
  transform?: [number, number, number, number, number, number];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  role: 'node' | 'edge' | 'arrow' | 'glyph' | 'label-background' | 'call-decoration';
  owner: string;
}
export interface DiagramScene {
  schemaVersion: 1;
  id: string;
  title: string;
  width: number;
  height: number;
  status: 'ready' | 'rejected';
  nodes: SceneNode[];
  edges: SceneEdge[];
  primitives: PathPrimitive[];
  diagnostics: GeometryDiagnostic[];
  font: FontFingerprint;
  fontSize: number;
  style: DiagramStyle;
  graphDigest: string;
  styleDigest: string;
  sceneDigest: string;
  requestId: string;
  modelRevision: number | string;
  styleRevision: number;
  timings: { measurementMs: number; totalMs: number };
}
export interface LayoutOptions {
  modelRevision?: number | string;
  styleRevision?: number;
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface Viewport { x: number; y: number; scale: number }

export class DiagramError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DiagramError'; }
}

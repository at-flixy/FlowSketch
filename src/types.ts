export type AnalysisStatus = 'DISCOVERED' | 'BUILT_NORMAL_FLOW' | 'BUILT_WITH_ABSTRACTION' | 'INPUT_ERROR' | 'CONTEXT_REQUIRED' | 'UNSUPPORTED' | 'CANCELLED' | 'FAILURE';
export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
  utf16Column?: number;
}
export interface SourceRange {
  file: string;
  begin: SourcePosition;
  end: SourcePosition;
  endExclusive?: boolean;
  synthetic?: boolean;
  originKind?: string;
  offsetEncoding?: 'utf8-bytes';
  columnEncoding?: 'utf8-bytes';
}
export interface Diagnostic {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  sourceRange?: SourceRange;
  nodeId?: string;
  edgeId?: string;
}
export interface GraphNode {
  id: string;
  kind: 'terminator' | 'process' | 'decision' | 'io' | 'call' | 'connector';
  label: string;
  sourceRange?: SourceRange;
  originalText?: string | null;
  astKind?: string;
  reachable?: boolean;
  abstraction?: string | null;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  role: string;
  label?: string;
  layoutHint?: 'back';
  conditionBranch?: 'true' | 'false';
}
export interface SemanticGraph {
  id: string;
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  status?: AnalysisStatus;
  entryId?: string;
  exitId?: string;
  diagnostics?: Diagnostic[];
  abstractions?: unknown[];
  coverage?: Record<string, unknown>;
}
export interface FunctionInfo {
  id: string;
  name: string;
  signature: string;
  sourceRange: SourceRange;
  supported: boolean;
}
export interface AnalyzerResponse {
  protocolVersion: 1;
  requestId: string;
  sourceRevision: number;
  sourceDigest: string;
  contextDigest: string;
  analyzerVersion: string;
  status: AnalysisStatus;
  functions: FunctionInfo[];
  functionId?: string;
  graph?: SemanticGraph | null;
  diagnostics: Diagnostic[];
  coverage?: Record<string, unknown>;
  elapsedMs?: number;
}
export type TemplateId = 'educational' | 'monochrome' | 'cool' | 'contrast';
export interface DiagramStyle {
  templateId: TemplateId;
  fontFamily: 'Liberation Sans';
  fontSize: number;
  strokeWidth: number;
  nodeFill: string;
  decisionFill: string;
  terminalFill: string;
  textColor: string;
  lineColor: string;
  background: string;
}
export interface FlowProject {
  schemaVersion: 1;
  title: string;
  source: string;
  sourceRevision: number;
  sourcePath?: string | null;
  functionId?: string;
  style: DiagramStyle;
  createdAt?: string;
  updatedAt?: string;
}
export interface AnalyzeInput {
  source: string;
  functionId?: string;
  revision: number;
  requestId: string;
  discoverOnly?: boolean;
}
export type ExportFormat = 'svg' | 'png' | 'pdf';

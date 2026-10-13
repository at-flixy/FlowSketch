export { DiagramCanvas } from './DiagramCanvas';
export type { DiagramCanvasProps } from './DiagramCanvas';
export { layoutGraph, cancelLayout, createLayoutController } from './client';
export { defaultStyle, normalizeStyle, templates, STYLE_PRESETS } from './styles';
export { sceneSvg, exportSvg, exportPng, pngDimensions, requireReady } from './export';
export { validateScene } from './geometry';
export type { DiagramScene, SceneNode, SceneEdge, GeometryDiagnostic, LayoutOptions, Viewport, DiagramStyle, SemanticGraph } from './types';
export { DiagramError } from './types';

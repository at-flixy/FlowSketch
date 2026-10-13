import type { DiagramScene, Point, Viewport } from './types';
export const clampZoom = (scale: number) => Math.max(.1, Math.min(4, scale));
export function fitViewport(scene: Pick<DiagramScene, 'width' | 'height'>, width: number, height: number): Viewport {
  const scale = clampZoom(Math.min(1, (width - 48) / scene.width, (height - 48) / scene.height));
  return { scale, x: (width - scene.width * scale) / 2, y: (height - scene.height * scale) / 2 };
}
export function zoomAt(viewport: Viewport, nextScale: number, anchor: Point): Viewport {
  const scale = clampZoom(nextScale), ratio = scale / viewport.scale;
  return { scale, x: anchor.x - (anchor.x - viewport.x) * ratio, y: anchor.y - (anchor.y - viewport.y) * ratio };
}

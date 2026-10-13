import { validateScene } from './geometry';
import { DiagramError, type DiagramScene, type PathPrimitive } from './types';

const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function requireReady(scene: DiagramScene): void {
  if (scene.status !== 'ready') throw new DiagramError('SCENE_NOT_READY', 'Сцена ещё не готова к экспорту.');
  const problems = validateScene(scene);
  if (problems.length) throw new DiagramError('SCENE_GEOMETRY_INVALID', problems[0].message);
}
export const pathMarkup = (path: PathPrimitive) => `<path d="${xml(path.d)}"${path.transform ? ` transform="matrix(${path.transform.join(' ')})"` : ''} fill="${path.fill ?? 'none'}"${path.stroke ? ` stroke="${path.stroke}" stroke-width="${path.strokeWidth}" stroke-linejoin="round" stroke-linecap="butt"` : ''}/>`;

/** Selection, grid, viewport, animation and hover are intentionally outside exports. */
export function sceneSvg(scene: DiagramScene): string {
  requireReady(scene);
  const metadata = { schemaVersion: scene.schemaVersion, graphDigest: scene.graphDigest, styleDigest: scene.styleDigest, sceneDigest: scene.sceneDigest,
    modelRevision: scene.modelRevision, styleRevision: scene.styleRevision, requestId: scene.requestId, font: scene.font,
    coverage: 'Обычные переходы внутри функции. Внутренние пути вызовов, исключения и скрытые действия объектов не раскрыты.',
    labels: scene.nodes.map(node => ({ id: node.id, label: node.label, originalText: node.originalText, sourceRange: node.sourceRange })),
    edges: scene.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, role: edge.role, layoutHint: edge.layoutHint })) };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><title>${xml(scene.title)}</title><metadata>${xml(JSON.stringify(metadata))}</metadata><rect width="100%" height="100%" fill="${scene.style.background}"/>${scene.primitives.map(pathMarkup).join('')}</svg>`;
}
export const exportSvg = (scene: DiagramScene): Blob => new Blob([sceneSvg(scene)], { type: 'image/svg+xml;charset=utf-8' });

export function pngDimensions(scene: DiagramScene, scale: 1 | 2 | 3 = 1): { width: number; height: number } {
  if (![1, 2, 3].includes(scale)) throw new DiagramError('PNG_SCALE_INVALID', 'Масштаб PNG должен быть 1×, 2× или 3×.');
  const width = Math.ceil(scene.width * scale), height = Math.ceil(scene.height * scale);
  if (width > 16384 || height > 16384 || width * height > 64_000_000) throw new DiagramError('PNG_SIZE_LIMIT', 'PNG превышает 16384 пикселя по стороне или 64 млн пикселей. Используйте SVG.');
  return { width, height };
}

export async function exportPng(scene: DiagramScene, options: { scale?: 1 | 2 | 3; signal?: AbortSignal } = {}): Promise<Blob> {
  requireReady(scene);
  const { width, height } = pngDimensions(scene, options.scale ?? 1);
  const checkAbort = () => { if (options.signal?.aborted) throw new DOMException('Экспорт отменён.', 'AbortError'); };
  checkAbort();
  const url = URL.createObjectURL(exportSvg(scene));
  let canvas: HTMLCanvasElement | undefined;
  try {
    const image = new Image(); image.src = url; await image.decode(); checkAbort();
    const surface = document.createElement('canvas'); canvas = surface; surface.width = width; surface.height = height;
    const context = surface.getContext('2d');
    if (!context) throw new DiagramError('PNG_CONTEXT_FAILED', 'Не удалось создать поверхность PNG.');
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => surface.toBlob(result => result ? resolve(result) : reject(new DiagramError('PNG_ENCODE_FAILED', 'Браузер не смог сохранить PNG этого размера.')), 'image/png'));
    checkAbort(); return blob;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError' || error instanceof DiagramError) throw error;
    throw new DiagramError('PNG_RENDER_FAILED', 'Не удалось отрисовать PNG. Векторный SVG остаётся доступен.');
  } finally { if (canvas) { canvas.width = 0; canvas.height = 0; } URL.revokeObjectURL(url); }
}

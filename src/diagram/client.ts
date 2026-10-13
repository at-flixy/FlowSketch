import type { DiagramStyle, SemanticGraph } from '../types';
import { normalizeStyle } from './styles';
import { DiagramError, type DiagramScene, type LayoutOptions } from './types';
import elkWorkerAssetUrl from 'elkjs/lib/elk-worker.min.js?url';

const fontUrl = new URL('./fonts/LiberationSans-Regular.ttf', import.meta.url).href;
let fontBytesPromise: Promise<ArrayBuffer> | undefined;
let elkBytesPromise: Promise<ArrayBuffer> | undefined;
function loadFont(): Promise<ArrayBuffer> {
  return fontBytesPromise ??= fetch(fontUrl).then(response => {
    if (!response.ok) throw new DiagramError('FONT_LOAD_FAILED', 'Не удалось загрузить локальный шрифт схемы.');
    return response.arrayBuffer();
  }).catch(error => { fontBytesPromise = undefined; throw error; });
}

function loadElkWorker(): Promise<ArrayBuffer> {
  return elkBytesPromise ??= fetch(elkWorkerAssetUrl).then(response => {
    if (!response.ok) throw new DiagramError('ELK_WORKER_LOAD_FAILED', 'Не удалось загрузить локальный движок раскладки.');
    return response.arrayBuffer();
  }).catch(error => { elkBytesPromise = undefined; throw error; });
}

/** Per workspace controller. An old worker is terminated, never merely hidden. */
export function createLayoutController() {
  let cancelPending: (() => void) | undefined;
  return {
    cancel() { cancelPending?.(); },
    dispose() { cancelPending?.(); },
    layoutGraph(graph: SemanticGraph, style: Partial<DiagramStyle> = {}, options: LayoutOptions = {}): Promise<DiagramScene> {
      cancelPending?.();
      if (options.signal?.aborted) return Promise.reject(new DOMException('Построение отменено.', 'AbortError'));
      const normalized = normalizeStyle(style), requestId = options.requestId ?? crypto.randomUUID();
      return new Promise((resolve, reject) => {
        let finished = false, worker: Worker | undefined, elkWorkerUrl: string | undefined;
        const cleanup = () => {
          clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); worker?.terminate();
          if (elkWorkerUrl) { URL.revokeObjectURL(elkWorkerUrl); elkWorkerUrl = undefined; }
          if (cancelPending === cancel) cancelPending = undefined;
        };
        const fail = (error: unknown) => { if (finished) return; finished = true; cleanup(); reject(error); };
        const cancel = () => fail(new DOMException('Построение отменено.', 'AbortError'));
        cancelPending = cancel;
        const timer = setTimeout(() => fail(new DiagramError('LAYOUT_TIMEOUT', 'Превышено время построения сцены.')), options.timeoutMs ?? 5000);
        options.signal?.addEventListener('abort', cancel, { once: true });
        void Promise.all([loadFont(), loadElkWorker()]).then(([bytes, elkBytes]) => {
          if (finished) return;
          // Windows WebView2/Tauri cannot fetch a nested worker over its custom
          // protocol (tauri#15755). Window fetches only this immutable local
          // asset; the child receives a Blob URL, revoked after termination.
          elkWorkerUrl = URL.createObjectURL(new Blob([elkBytes], { type: 'text/javascript' }));
          worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
          worker.onerror = () => fail(new DiagramError('WORKER_FAILURE', 'Не удалось запустить локальный движок схемы.'));
          worker.onmessage = event => {
            if (finished || event.data.requestId !== requestId) return;
            if (!event.data.ok) {
              const error = new DiagramError(event.data.code, event.data.message);
              if (event.data.stack) error.stack = event.data.stack;
              fail(error); return;
            }
            finished = true; cleanup(); resolve(event.data.scene as DiagramScene);
          };
          const fontBytes = bytes.slice(0);
          worker.postMessage({ graph: structuredClone(graph), style: normalized, fontBytes, elkWorkerUrl, context: { requestId, modelRevision: options.modelRevision ?? 0, styleRevision: options.styleRevision ?? 0 } }, [fontBytes]);
        }).catch(fail);
      });
    },
  };
}
const defaultController = createLayoutController();
export const layoutGraph = defaultController.layoutGraph;
export const cancelLayout = defaultController.cancel;

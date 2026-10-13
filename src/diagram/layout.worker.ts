/// <reference lib="webworker" />
import type { DiagramStyle, SemanticGraph } from '../types';
import { createScene, type SceneContext } from './engine';
import { createDiagramFont } from './font';

interface WorkerInput { graph: SemanticGraph; style: DiagramStyle; fontBytes: ArrayBuffer; elkWorkerUrl: string; context: SceneContext }
self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const input = event.data;
  try {
    if (!input.elkWorkerUrl?.startsWith('blob:')) throw new Error('Локальный движок раскладки должен быть передан как Blob URL.');
    const font = await createDiagramFont(new Uint8Array(input.fontBytes));
    const scene = await createScene(input.graph, input.style, font, input.context, undefined, input.elkWorkerUrl);
    self.postMessage({ requestId: input.context.requestId, ok: true, scene });
  } catch (error) {
    const problem = error as Error & { code?: string };
    self.postMessage({ requestId: input.context.requestId, ok: false, code: problem.code ?? 'LAYOUT_FAILURE', message: problem.message || 'Не удалось разместить схему.', stack: problem.stack });
  }
};

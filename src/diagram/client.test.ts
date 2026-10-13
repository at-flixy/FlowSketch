import { afterEach, expect, it, vi } from 'vitest';
import type { SemanticGraph } from '../types';
import { createLayoutController } from './client';

const graph: SemanticGraph = { id: 'transport', title: 'Transport-only test', nodes: [{ id: 's', kind: 'terminator', label: 'Начало' }], edges: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('a superseded worker is terminated and its result cannot publish', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminated = false;
    input?: { context: { requestId: string }; elkWorkerUrl: string };
    constructor() { workers.push(this); }
    terminate() { this.terminated = true; }
    postMessage(input: { context: { requestId: string }; elkWorkerUrl: string }) { this.input = input; }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  const controller = createLayoutController();
  const first = controller.layoutGraph(graph, {}, { requestId: 'old' });
  const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  expect(workers[0].input?.elkWorkerUrl).toMatch(/^blob:/);
  const second = controller.layoutGraph(graph, {}, { requestId: 'new' });
  await firstRejected;
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  expect(workers[0].terminated).toBe(true);
  expect(revoke).toHaveBeenCalledWith(workers[0].input!.elkWorkerUrl);
  let resolved = false; void second.then(() => { resolved = true; });
  workers[0].onmessage?.({ data: { requestId: 'old', ok: true, scene: { requestId: 'old' } } });
  workers[1].onmessage?.({ data: { requestId: 'old', ok: true, scene: { requestId: 'old' } } });
  await Promise.resolve(); expect(resolved).toBe(false);
  workers[1].onmessage?.({ data: { requestId: 'new', ok: true, scene: { requestId: 'new' } } });
  expect(await second).toMatchObject({ requestId: 'new' }); expect(workers[1].terminated).toBe(true);
  expect(revoke).toHaveBeenCalledWith(workers[1].input!.elkWorkerUrl);
  controller.dispose();
});

it('releases the local ELK Blob URL when starting the outer worker fails', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL'), create = vi.spyOn(URL, 'createObjectURL');
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker startup failed'); } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  await expect(createLayoutController().layoutGraph(graph)).rejects.toThrow('Worker startup failed');
  expect(create).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith(create.mock.results[0].value);
});

it('an already aborted request never starts a worker', async () => {
  const constructor = vi.fn(); vi.stubGlobal('Worker', constructor);
  const controller = new AbortController(); controller.abort();
  await expect(createLayoutController().layoutGraph(graph, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(constructor).not.toHaveBeenCalled();
});

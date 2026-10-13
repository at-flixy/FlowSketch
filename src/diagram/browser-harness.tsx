/** Development-only browser test entry. Not imported by the application. No analyzer API mocks. */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import graphFixture from '../../spikes/clang/sumOdd.graph.json';
import type { DiagramStyle, SemanticGraph } from '../types';
import { createLayoutController } from './client';
import { DiagramCanvas } from './DiagramCanvas';
import { exportPng, sceneSvg } from './export';
import { templates } from './styles';
import type { DiagramScene, LayoutOptions } from './types';

const fixture = graphFixture as SemanticGraph;
interface HarnessApi {
  build(style?: DiagramStyle, options?: LayoutOptions): Promise<Record<string, unknown>>;
  png(scale?: 1 | 2 | 3): Promise<Record<string, unknown>>;
  pngBlob(scale?: 1 | 2 | 3): Promise<Blob>;
  svg(): string;
  snapshot(): Record<string, unknown>;
}
declare global { interface Window { __diagramHarness?: HarnessApi } }

function Harness() {
  const controller = useRef(createLayoutController());
  const [scene, setScene] = useState<DiagramScene | null>(null), current = useRef<DiagramScene | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState('Загрузка локального worker и шрифта…');
  useEffect(() => {
    const api: HarnessApi = {
      async build(style = templates[2].style, options = {}) {
        setMessage('Реальная браузерная раскладка…');
        const next = await controller.current.layoutGraph(fixture, style, { requestId: crypto.randomUUID(), modelRevision: 1, styleRevision: 1, ...options });
        current.current = next; setScene(next); setMessage(next.status === 'ready' ? 'Сцена готова' : next.diagnostics.map(item => item.code).join(', '));
        return api.snapshot();
      },
      async png(scale = 1) {
        if (!current.current) throw new Error('No scene');
        const blob = await exportPng(current.current, { scale }), buffer = await blob.arrayBuffer(), header = new DataView(buffer);
        return { type: blob.type, bytes: blob.size, width: header.getUint32(16), height: header.getUint32(20), signature: Array.from(new Uint8Array(buffer).slice(0, 8)), sceneDigest: current.current.sceneDigest };
      },
      async pngBlob(scale = 1) { if (!current.current) throw new Error('No scene'); return exportPng(current.current, { scale }); },
      svg() { if (!current.current) throw new Error('No scene'); return sceneSvg(current.current); },
      snapshot() { const value = current.current; return value ? { status: value.status, width: value.width, height: value.height, nodes: value.nodes.length, edges: value.edges.length, primitives: value.primitives.length, font: value.font, sceneDigest: value.sceneDigest, graphDigest: value.graphDigest, styleDigest: value.styleDigest, diagnostics: value.diagnostics, requestId: value.requestId, modelRevision: value.modelRevision, styleRevision: value.styleRevision, timings: value.timings } : { status: 'empty' }; },
    };
    window.__diagramHarness = api;
    void api.build().catch(error => { console.error(error); setMessage(error.stack ?? String(error)); });
    return () => { controller.current.dispose(); delete window.__diagramHarness; };
  }, []);
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ padding: '12px 20px', borderBottom: '1px solid #303a50', display: 'flex', justifyContent: 'space-between', gap: 20 }}>
      <strong>Проверка браузерного движка — fixture из реального Clang, без анализа C++ в этой странице</strong>
      <span data-test-status>{message}</span>
    </header>
    <div style={{ flex: 1, minHeight: 0 }}><DiagramCanvas scene={scene} selectedNodeId={selected} onSelectNode={setSelected} onClearSelection={() => setSelected(null)} ariaLabel="Проверочная блок-схема sumOdd" /></div>
    <footer style={{ padding: '10px 20px', minHeight: 20 }} data-test-selection>{selected ? `Выбран блок: ${selected}` : 'Блок не выбран'}</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

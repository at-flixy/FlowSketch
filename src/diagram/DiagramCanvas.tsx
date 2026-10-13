import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DiagramScene, PathPrimitive, Viewport } from './types';
import { fitViewport, zoomAt } from './viewport';
import './DiagramCanvas.css';

export interface DiagramCanvasProps {
  scene: DiagramScene | null;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
  onClearSelection?: () => void;
  stale?: boolean;
  ariaLabel?: string;
  onViewportChange?: (viewport: Viewport) => void;
  initialViewport?: Viewport;
}

function ScenePath({ path }: { path: PathPrimitive }) {
  return <path d={path.d} transform={path.transform ? `matrix(${path.transform.join(' ')})` : undefined}
    fill={path.fill ?? 'none'} stroke={path.stroke} strokeWidth={path.strokeWidth} strokeLinejoin="round" strokeLinecap="butt" />;
}

/** Exact scene primitives + a separate interaction layer. Selection never enters exports. */
export function DiagramCanvas({ scene, selectedNodeId, onSelectNode, onClearSelection, stale = false, ariaLabel = 'Блок-схема', onViewportChange, initialViewport }: DiagramCanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>(initialViewport ?? { x: 0, y: 0, scale: 1 });
  const viewportRef = useRef(viewport), fittedScene = useRef<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; viewport: Viewport } | null>(null);
  const suppressClick = useRef(false);
  const [panning, setPanning] = useState(false);
  const space = useRef(false);

  const updateViewport = useCallback((next: Viewport) => { viewportRef.current = next; setViewport(next); onViewportChange?.(next); }, [onViewportChange]);
  const fit = useCallback(() => { if (scene && bounds.width > 0 && bounds.height > 0) updateViewport(fitViewport(scene, bounds.width, bounds.height)); }, [scene, bounds, updateViewport]);
  const zoom = useCallback((factor: number) => updateViewport(zoomAt(viewportRef.current, viewportRef.current.scale * factor, { x: bounds.width / 2, y: bounds.height / 2 })), [bounds, updateViewport]);

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { const rect = entries[0].contentRect; setBounds({ width: rect.width, height: rect.height }); });
    observer.observe(element); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scene && scene.sceneDigest !== fittedScene.current && bounds.width > 0 && bounds.height > 0) { fittedScene.current = scene.sceneDigest; fit(); }
  }, [scene, bounds, fit]);

  useEffect(() => {
    const node = scene?.nodes.find(item => item.id === selectedNodeId), current = viewportRef.current;
    if (!node || bounds.width === 0) return;
    const x = current.x + node.x * current.scale, y = current.y + node.y * current.scale;
    if (x < 16 || y < 16 || x + node.width * current.scale > bounds.width - 16 || y + node.height * current.scale > bounds.height - 16) {
      updateViewport({ ...current, x: bounds.width / 2 - (node.x + node.width / 2) * current.scale, y: bounds.height / 2 - (node.y + node.height / 2) * current.scale });
    }
  }, [selectedNodeId, scene?.sceneDigest, bounds.width, bounds.height, updateViewport]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewportRef.current, rect = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) updateViewport(zoomAt(current, current.scale * Math.exp(-event.deltaY * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
      else updateViewport({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [updateViewport]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const node = (event.target as Element).closest('[data-node-id]');
    if (event.button !== 1 && !(event.button === 0 && (!node || space.current))) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport: viewportRef.current }; setPanning(true);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) suppressClick.current = true;
      updateViewport({ ...start.viewport, x: start.viewport.x + event.clientX - start.x, y: start.viewport.y + event.clientY - start.y });
    }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = viewportRef.current, amount = event.shiftKey ? 72 : 36;
    if (event.key === ' ') { space.current = true; event.preventDefault(); return; }
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-' || event.key === '_') zoom(1 / 1.2);
    else if (event.key === 'Home') fit();
    else if (event.key === '0') updateViewport(zoomAt(current, 1, { x: bounds.width / 2, y: bounds.height / 2 }));
    else if (event.key === 'ArrowLeft') updateViewport({ ...current, x: current.x + amount });
    else if (event.key === 'ArrowRight') updateViewport({ ...current, x: current.x - amount });
    else if (event.key === 'ArrowUp') updateViewport({ ...current, y: current.y + amount });
    else if (event.key === 'ArrowDown') updateViewport({ ...current, y: current.y - amount });
    else if (event.key === 'Escape') onClearSelection?.();
    else return;
    event.preventDefault();
  };

  return <div className="fs-diagram" data-scene-status={scene?.status ?? 'empty'}>
    <div className="fs-diagram-toolbar" role="toolbar" aria-label="Масштаб и обзор схемы">
      <button type="button" onClick={() => zoom(1 / 1.2)} disabled={!scene} aria-label="Уменьшить масштаб" title="Уменьшить масштаб (-)">−</button>
      <button type="button" className="fs-diagram-percent" onClick={() => updateViewport(zoomAt(viewportRef.current, 1, { x: bounds.width / 2, y: bounds.height / 2 }))} disabled={!scene} aria-label="Масштаб 100 процентов" title="Масштаб 100% (0)">{Math.round(viewport.scale * 100)}%</button>
      <button type="button" onClick={() => zoom(1.2)} disabled={!scene} aria-label="Увеличить масштаб" title="Увеличить масштаб (+)">+</button>
      <button type="button" onClick={fit} disabled={!scene} aria-label="Показать всю схему" title="Показать всю схему (Home)"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button>
      {stale && <span className="fs-diagram-stale" role="status">Устарела</span>}
    </div>
    <div ref={surface} className={`fs-diagram-surface${panning ? ' is-panning' : ''}`} tabIndex={0} role="region" aria-label={ariaLabel}
      aria-description="Выберите блок для перехода к коду. Стрелки — панорамирование, плюс и минус — масштаб, Home — вся схема. Ctrl и колесо — масштабирование."
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={keys}
      onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
      onKeyUp={event => { if (event.key === ' ') space.current = false; }} onBlur={() => { space.current = false; }}>
      {scene ? <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(1, bounds.width)} ${Math.max(1, bounds.height)}`} role="group" aria-label={scene.title} data-scene-digest={scene.sceneDigest}>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`} data-viewport-scale={viewport.scale}>
          <rect width={scene.width} height={scene.height} fill={scene.style.background} />
          {scene.primitives.map((path, index) => <ScenePath key={index} path={path} />)}
          {scene.nodes.map((node, index) => <g key={node.id} data-node-id={node.id} role="button" tabIndex={0}
            aria-label={`${node.kind === 'decision' ? 'Условие' : 'Блок'}: ${node.label}`} aria-pressed={selectedNodeId === node.id}
            onClick={event => { if (!space.current && !drag.current) { event.stopPropagation(); onSelectNode?.(node.id); } }}
            onFocus={() => onSelectNode?.(node.id)} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelectNode?.(node.id); }
              else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); const next = scene.nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + scene.nodes.length) % scene.nodes.length]; onSelectNode?.(next.id); surface.current?.querySelector<SVGGElement>(`[data-node-id="${CSS.escape(next.id)}"]`)?.focus(); }
            }}>
            <title>{node.label}</title>
            <path d={node.outlinePath} className={`fs-diagram-hit${selectedNodeId === node.id ? ' is-selected' : ''}`} vectorEffect="non-scaling-stroke" />
          </g>)}
        </g>
      </svg> : <div className="fs-diagram-empty">Схема появится после построения.</div>}
    </div>
  </div>;
}

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Code2, Copy, FileCode2, FilePlus2, FolderOpen, Grid2X2, Info, LoaderCircle, Palette, RefreshCw, Save, Settings2, Undo2, Redo2, X, Download, WandSparkles, CircleHelp, Minus, Square } from 'lucide-react';
import { analyze, cancelAnalysis, desktopAvailable, openCpp, openProject, saveExport, saveProject } from './api';
import type { AnalyzerResponse, Diagnostic, DiagramStyle, FlowProject, FunctionInfo, GraphNode } from './types';
import { DiagramCanvas, layoutGraph, createLayoutController, sceneSvg, exportSvg, templates, normalizeStyle } from './diagram';
import type { DiagramScene } from './diagram/types';
import { CodeEditor, type CodeEditorHandle } from './components/CodeEditor';
import { Modal } from './components/Modal';
import { getCurrentWindow } from '@tauri-apps/api/window';

const SAMPLE = `int sumOdd(int n) {
    int s = 0;
    for (int i = 1; i <= n; ++i) {
        if (i % 2 == 0) continue;
        s += i;
    }
    return s;
}
`;
const STORAGE_KEY = 'flowsketch.style-library.v1';
type Mode = 'code' | 'formatting';
type Stage = 'idle' | 'discovering' | 'analyzing' | 'cancelled' | 'error' | 'unsupported';
interface StyleItem { key: string; name: string; description: string; style: DiagramStyle; custom?: boolean; }
interface Library { last: string; recent: string[]; custom: StyleItem[]; }
interface Notice { message: string; error?: boolean; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function fileName(path: string | null) { return path?.split(/[\\/]/).pop() || 'Пример · sum_odd.cpp'; }
function readLibrary(): Library {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Library>;
    return { last: typeof value.last === 'string' ? value.last : 'cool', recent: Array.isArray(value.recent) ? value.recent.filter(item => typeof item === 'string').slice(0, 8) : [], custom: Array.isArray(value.custom) ? value.custom.filter(item => typeof item.key === 'string' && typeof item.name === 'string').map(item => ({ ...item, custom: true, style: normalizeStyle(item.style) })) : [] };
  } catch { return { last: 'cool', recent: [], custom: [] }; }
}
function initialStyle() {
  const library = readLibrary();
  const selected = library.custom.find(item => item.key === library.last) || templates.find(item => item.id === library.last);
  return normalizeStyle(selected?.style || templates.find(item => item.id === 'cool')!.style);
}
function StatusIcon({ state }: { state: string }) {
  return state === 'current' ? <CheckCircle2 size={16} aria-hidden="true" /> : state === 'pending' ? <LoaderCircle className="spinner" size={16} aria-hidden="true" /> : state === 'error' || state === 'stale' ? <AlertCircle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />;
}

export default function App() {
  const [source, setSource] = useState(SAMPLE);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [title, setTitle] = useState('Сумма нечётных');
  const [revision, setRevision] = useState(1);
  const revisionRef = useRef(1);
  const sourceRef = useRef(source); sourceRef.current = source;
  const [mode, setMode] = useState<Mode>('code');
  const [mobileView, setMobileView] = useState<'source' | 'diagram'>('source');
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [propertyTab, setPropertyTab] = useState<'block' | 'diagram'>('diagram');
  const [style, setStyle] = useState<DiagramStyle>(initialStyle);
  const styleRef = useRef(style); styleRef.current = style;
  const [styleRevision, setStyleRevision] = useState(1);
  const [stylePast, setStylePast] = useState<DiagramStyle[]>([]);
  const [styleFuture, setStyleFuture] = useState<DiagramStyle[]>([]);
  const [library, setLibrary] = useState<Library>(readLibrary);
  const [dirty, setDirty] = useState(false);
  const [functions, setFunctions] = useState<FunctionInfo[]>([]);
  const [functionsRevision, setFunctionsRevision] = useState(0);
  const [functionId, setFunctionId] = useState<string>('');
  const functionRef = useRef(functionId); functionRef.current = functionId;
  const [result, setResult] = useState<AnalyzerResponse | null>(null);
  const resultCache = useRef(new Map<string, AnalyzerResponse>());
  const [scene, setScene] = useState<DiagramScene | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [layoutPending, setLayoutPending] = useState(false);
  const [layoutDiagnostics, setLayoutDiagnostics] = useState<Diagnostic[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [galleryKey, setGalleryKey] = useState('cool');
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'recent' | 'custom'>('all');
  const [galleryScene, setGalleryScene] = useState<DiagramScene | null>(null);
  const [galleryPending, setGalleryPending] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [saveStyleDialog, setSaveStyleDialog] = useState(false);
  const [styleName, setStyleName] = useState('Мой стиль');
  const [help, setHelp] = useState(false);
  const [openChoice, setOpenChoice] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<(() => Promise<void> | void) | null>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const request = useRef<string | null>(null);
  const layoutAbort = useRef<AbortController | null>(null);
  const [previewController] = useState(createLayoutController);
  const latestBuild = useRef<() => Promise<void>>(async () => {});
  const latestSave = useRef<() => Promise<boolean>>(async () => false);
  const latestCancel = useRef<() => Promise<void>>(async () => {});
  const latestNew = useRef<() => void>(() => {});
  const latestUndo = useRef<() => void>(() => {});
  const latestRedo = useRef<() => void>(() => {});
  const modeRef = useRef(mode); modeRef.current = mode;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const isDesktop = desktopAvailable();
  const pending = stage === 'analyzing' || stage === 'discovering';
  const current = !!result?.graph && result.sourceRevision === revision && scene?.status === 'ready' && !layoutPending && !pending && stage === 'idle' && scene.modelRevision === revision && scene.styleRevision === styleRevision;
  const stale = !!scene && (!result || result.sourceRevision !== revision);
  const allStyles: StyleItem[] = [...templates.map(item => ({ ...item, key: item.id })), ...library.custom];
  const selectedStyleItem = allStyles.find(item => item.key === galleryKey) || allStyles[0];
  const visibleStyles = galleryFilter === 'recent' ? library.recent.map(key => allStyles.find(item => item.key === key)).filter((item): item is StyleItem => !!item) : galleryFilter === 'custom' ? library.custom : allStyles;
  const selectedNode = result?.graph?.nodes.find(node => node.id === selectedNodeId);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), notice.error ? 12000 : 7000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!isDesktop) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested(event => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      setGallery(false); setHelp(false); setSaveStyleDialog(false); setOpenChoice(false);
      setPendingReplace(() => async () => { dirtyRef.current = false; await getCurrentWindow().destroy(); });
    }).then(value => { if (stopped) value(); else unlisten = value; }).catch(error => setNotice({ message: `Не удалось включить проверку несохранённых изменений: ${errorMessage(error)}`, error: true }));
    return () => { stopped = true; unlisten?.(); };
  }, [isDesktop]);

  function persistLibrary(next: Library) {
    setLibrary(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { setNotice({ message: 'Стиль применён. Библиотеку не удалось сохранить на этом устройстве.', error: true }); }
  }
  const applyStyle = useCallback((next: DiagramStyle, history = true) => {
    try {
      const normalized = normalizeStyle(next);
      const previous = styleRef.current;
      if (JSON.stringify(normalized) === JSON.stringify(previous)) return;
      if (history) { setStylePast(past => [...past.slice(-99), previous]); setStyleFuture([]); }
      setStyle(normalized); styleRef.current = normalized;
      setStyleRevision(value => value + 1); setDirty(true);
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }, []);
  function undoStyle() {
    if (!stylePast.length) return;
    const previous = stylePast[stylePast.length - 1];
    const currentStyle = styleRef.current;
    setStyleFuture(future => [currentStyle, ...future]);
    setStylePast(past => past.slice(0, -1)); applyStyle(previous, false);
  }
  function redoStyle() {
    if (!styleFuture.length) return;
    const next = styleFuture[0];
    const currentStyle = styleRef.current;
    setStylePast(past => [...past.slice(-99), currentStyle]);
    setStyleFuture(future => future.slice(1)); applyStyle(next, false);
  }

  async function invalidateRequest() {
    const id = request.current; request.current = null;
    layoutAbort.current?.abort();
    setLayoutPending(false);
    if (id) { try { await cancelAnalysis(id); } catch (error) { setNotice({ message: `Не удалось остановить анализ: ${errorMessage(error)}. Его устаревший результат не будет применён.`, error: true }); return false; } }
    return true;
  }
  function changeSource(next: string) {
    if (next === sourceRef.current) return;
    void invalidateRequest();
    const nextRevision = revisionRef.current + 1;
    revisionRef.current = nextRevision;
    setRevision(nextRevision); setSource(next); sourceRef.current = next;
    setDirty(true); setSelectedNodeId(null); setStage('idle'); setDiagnostics([]);
  }

  async function runAnalysis(discoverOnly = false, explicitFunctionId?: string) {
    if (request.current || pending || !sourceRef.current.trim()) return;
    const inputSource = sourceRef.current;
    const inputRevision = revisionRef.current;
    const id = crypto.randomUUID(); request.current = id;
    setStage(discoverOnly ? 'discovering' : 'analyzing'); setDiagnostics([]); setLayoutDiagnostics([]);
    try {
      const response = await analyze({ source: inputSource, revision: inputRevision, requestId: id, functionId: explicitFunctionId ?? (functionsRevision === inputRevision ? functionId || undefined : undefined), discoverOnly });
      if (request.current !== id || revisionRef.current !== inputRevision) return;
      request.current = null;
      setFunctions(response.functions || []); setFunctionsRevision(inputRevision); setDiagnostics(response.diagnostics || []);
      if (response.status === 'DISCOVERED') {
        setStage('idle');
        if (!response.functions.some(item => item.id === functionId)) setFunctionId(response.functions.find(item => item.supported)?.id || response.functions[0]?.id || '');
        if (!response.functions.length) setNotice({ message: 'Определения функций не найдены. Добавьте законченную функцию C++.', error: true });
        return;
      }
      if ((response.status === 'BUILT_NORMAL_FLOW' || response.status === 'BUILT_WITH_ABSTRACTION') && response.graph) {
        setResult(response); setStage('idle'); setSelectedNodeId(null);
        const nextFunctionId = response.functionId || response.graph.id;
        setFunctionId(nextFunctionId); resultCache.current.set(nextFunctionId, response);
        setMobileView('diagram');
      } else if (response.status === 'CANCELLED') setStage('cancelled');
      else setStage(response.status === 'UNSUPPORTED' || response.status === 'CONTEXT_REQUIRED' ? 'unsupported' : 'error');
    } catch (error) {
      if (request.current !== id || revisionRef.current !== inputRevision) return;
      request.current = null; setStage('error');
      setDiagnostics([{ code: 'ANALYSIS_FAILED', message: errorMessage(error), severity: 'error' }]);
    }
  }
  latestBuild.current = () => runAnalysis();
  async function cancel() {
    const hadRequest = !!request.current;
    layoutAbort.current?.abort();
    const stopped = await invalidateRequest();
    setStage(stopped ? 'cancelled' : 'error'); setLayoutPending(false);
    if (!stopped) setDiagnostics([{ code: 'CANCEL_FAILED', message: 'Остановка анализатора не подтверждена. Его результат не будет применён.', severity: 'error' }]);
    if (!hadRequest) setNotice({ message: 'Построение раскладки отменено.' });
  }
  latestCancel.current = cancel;

  useEffect(() => {
    if (!result?.graph) return;
    const controller = new AbortController(); layoutAbort.current = controller;
    let active = true;
    setLayoutPending(true); setLayoutDiagnostics([]);
    layoutGraph(result.graph, style, { modelRevision: result.sourceRevision, styleRevision, requestId: result.requestId, signal: controller.signal }).then(next => {
      if (!active || controller.signal.aborted) return;
      setScene(next); setLayoutPending(false);
      if (next.status !== 'ready') setLayoutDiagnostics(next.diagnostics.map(item => ({ ...item, severity: 'error' as const })));
    }).catch(error => {
      if (!active || controller.signal.aborted) return;
      setLayoutPending(false); setLayoutDiagnostics([{ code: 'LAYOUT_FAILED', message: errorMessage(error), severity: 'error' }]);
    });
    return () => { active = false; controller.abort(); };
  }, [result, style, styleRevision]);

  function selectFunction(nextId: string) {
    if (nextId === functionId) return;
    void invalidateRequest(); setFunctionId(nextId); setSelectedNodeId(null); setDiagnostics([]); setStage('idle'); setDirty(true);
    // A cached model still needs its own scene; an old function's scene is never current.
    setScene(null);
    const cached = resultCache.current.get(nextId);
    if (cached?.sourceRevision === revisionRef.current) setResult(cached);
    else setResult(null);
  }
  function selectNode(id: string) {
    if (!current) return;
    setSelectedNodeId(id); setPropertyTab('block');
    const node = result?.graph?.nodes.find(item => item.id === id);
    if (node?.sourceRange && !node.sourceRange.synthetic) editor.current?.reveal(node.sourceRange);
  }
  function cursorChanged(offset: number) {
    if (!current) return;
    const candidates = result?.graph?.nodes.filter(node => node.sourceRange && !node.sourceRange.synthetic && node.sourceRange.begin.offset <= offset && node.sourceRange.end.offset > offset) || [];
    candidates.sort((a, b) => (a.sourceRange!.end.offset - a.sourceRange!.begin.offset) - (b.sourceRange!.end.offset - b.sourceRange!.begin.offset));
    setSelectedNodeId(candidates[0]?.id || null);
  }

  async function openCppFile() {
    try {
      const value = await openCpp(); if (!value) return;
      await invalidateRequest();
      const nextRevision = revisionRef.current + 1; revisionRef.current = nextRevision;
      setSource(value.source); sourceRef.current = value.source; setRevision(nextRevision); setSourcePath(value.path);
      setTitle(fileName(value.path).replace(/\.cpp$/i, '')); setProjectPath(null); setDirty(true);
      setResult(null); setScene(null); setFunctions([]); setFunctionId(''); setDiagnostics([]); setStage('idle'); setSelectedNodeId(null); resultCache.current.clear();
      setMode('code'); setMobileView('source');
      setNotice({ message: `Открыт ${fileName(value.path)}. Выберите функцию или постройте схему.` });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }
  async function openSavedProject() {
    try {
      const value = await openProject(); if (!value) return;
      const restoredStyle = normalizeStyle(value.project.style);
      await invalidateRequest();
      const nextRevision = revisionRef.current + 1; revisionRef.current = nextRevision;
      setSource(value.project.source); sourceRef.current = value.project.source; setRevision(nextRevision);
      setSourcePath(value.project.sourcePath || null); setProjectPath(value.path); setTitle(value.project.title);
      setStyle(restoredStyle); styleRef.current = restoredStyle; setStyleRevision(number => number + 1);
      setFunctionId(value.project.functionId || ''); setFunctions([]); setFunctionsRevision(nextRevision);
      setResult(null); setScene(null); setSelectedNodeId(null); setDirty(false); setStage('idle'); setDiagnostics([]); resultCache.current.clear(); setStylePast([]); setStyleFuture([]);
      setMode('code'); setMobileView('source');
      setNotice({ message: 'Проект открыт. Код и оформление восстановлены; постройте схему для этого исходника.' });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }
  function replaceWith(action: () => Promise<void> | void) {
    if (dirty) setPendingReplace(() => action); else void action();
  }
  function newProject() {
    void invalidateRequest();
    const nextRevision = revisionRef.current + 1; revisionRef.current = nextRevision;
    setSource(''); sourceRef.current = ''; setRevision(nextRevision); setSourcePath(null); setProjectPath(null); setTitle('Новый проект');
    setResult(null); setScene(null); setFunctions([]); setFunctionId(''); setDiagnostics([]); setSelectedNodeId(null); setStage('idle'); setDirty(false);
    setStyle(initialStyle()); setStyleRevision(number => number + 1); setStylePast([]); setStyleFuture([]); resultCache.current.clear();
    setMode('code'); setMobileView('source'); editor.current?.focus();
  }
  latestNew.current = () => replaceWith(newProject);
  latestUndo.current = undoStyle;
  latestRedo.current = redoStyle;
  async function save(): Promise<boolean> {
    if (savePending) return false;
    setSavePending(true);
    const snapshotSource = sourceRef.current;
    const snapshotStyle = styleRef.current;
    const snapshotRevision = revisionRef.current;
    const snapshotFunction = functionRef.current;
    try {
      const project: FlowProject = { schemaVersion: 1, title, source: snapshotSource, sourceRevision: snapshotRevision, sourcePath, functionId: snapshotFunction || undefined, style: snapshotStyle, updatedAt: new Date().toISOString() };
      const path = await saveProject(project); if (!path) return false;
      setProjectPath(path);
      if (snapshotRevision === revisionRef.current && snapshotFunction === functionRef.current && JSON.stringify(snapshotStyle) === JSON.stringify(styleRef.current)) setDirty(false);
      setNotice({ message: `Проект сохранён: ${fileName(path)}` }); return true;
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); return false; }
    finally { setSavePending(false); }
  }
  latestSave.current = save;
  async function exportDiagram() {
    if (!current || !scene || exportPending) return;
    setExportPending(true);
    try {
      const blob = exportSvg(scene);
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const path = await saveExport(bytes, 'svg', `${title.replace(/[<>:"/\\|?*]/g, '_') || 'FlowSketch'}.svg`);
      if (path) setNotice({ message: `SVG сохранён: ${fileName(path)}` });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
    finally { setExportPending(false); }
  }

  function showGallery(event?: MouseEvent<HTMLButtonElement>) {
    event?.currentTarget.focus();
    const exactMatch = allStyles.find(item => item.key === library.last && JSON.stringify(item.style) === JSON.stringify(style)) || allStyles.find(item => JSON.stringify(item.style) === JSON.stringify(style));
    setGalleryKey(exactMatch?.key || style.templateId); setGalleryFilter('all'); setGallery(true);
  }
  useEffect(() => {
    if (!gallery || !result?.graph) { setGalleryScene(null); setGalleryError(''); setGalleryPending(false); return; }
    const controller = new AbortController();
    setGalleryPending(true); setGalleryError('');
    previewController.layoutGraph(result.graph, selectedStyleItem.style, { modelRevision: result.sourceRevision, signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      if (value.status === 'ready') setGalleryScene(value); else { setGalleryScene(null); setGalleryError(value.diagnostics.map(item => item.message).join(' ')); }
      setGalleryPending(false);
    }).catch(error => { if (!controller.signal.aborted) { setGalleryPending(false); setGalleryScene(null); setGalleryError(errorMessage(error)); } });
    return () => controller.abort();
  }, [gallery, galleryKey, result]);
  function commitTemplate() {
    applyStyle(selectedStyleItem.style);
    persistLibrary({ ...library, last: selectedStyleItem.key, recent: [selectedStyleItem.key, ...library.recent.filter(key => key !== selectedStyleItem.key)].slice(0, 8) });
    setGallery(false);
  }
  function saveCustomStyle() {
    if (!styleName.trim()) return;
    const key = `custom-${crypto.randomUUID()}`;
    const item: StyleItem = { key, name: styleName.trim().slice(0, 80), description: 'Ваши настройки оформления', style: { ...style }, custom: true };
    persistLibrary({ ...library, custom: [...library.custom, item], last: key, recent: [key, ...library.recent].slice(0, 8) });
    setSaveStyleDialog(false); setNotice({ message: `Стиль «${item.name}» сохранён в библиотеке.` });
  }
  function arrange() {
    if (!result?.graph) return;
    setStyleRevision(value => value + 1); setNotice({ message: 'Размеры блоков и переходы будут пересчитаны.' });
  }
  async function windowAction(action: 'minimize' | 'maximize' | 'close') {
    try {
      const window = getCurrentWindow();
      if (action === 'minimize') await window.minimize();
      else if (action === 'maximize') await window.toggleMaximize();
      else await window.close();
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void latestSave.current(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); latestNew.current(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); setOpenChoice(true); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && modeRef.current === 'formatting') { event.preventDefault(); if (event.shiftKey) latestRedo.current(); else latestUndo.current(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void latestBuild.current(); }
      else if (event.key === 'Escape' && (request.current || layoutPending)) { event.preventDefault(); void latestCancel.current(); }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [layoutPending]);

  const allDiagnostics = [...diagnostics, ...layoutDiagnostics];
  const statusState = pending || layoutPending ? 'pending' : stage === 'error' || stage === 'unsupported' || layoutDiagnostics.length ? 'error' : stale ? 'stale' : current ? 'current' : 'idle';
  const statusText = pending ? stage === 'discovering' ? 'Поиск функций…' : 'Разбор кода…' : layoutPending ? 'Размещение блоков…' : stage === 'unsupported' ? 'Конструкция пока не поддерживается' : stage === 'error' || layoutDiagnostics.length ? 'Схема не построена' : stale ? 'Схема устарела' : current ? 'Схема актуальна' : stage === 'cancelled' ? 'Построение отменено' : 'Ожидает построения';

  return <div className="app">
    <a className="skip-link" href="#main-workspace">Перейти к рабочей области</a>
    <header className="topbar">
      <div className="brand-group" data-tauri-drag-region onDoubleClick={() => { if (isDesktop) void windowAction('maximize'); }}><div className="brand" data-tauri-drag-region><span className="brand-mark" data-tauri-drag-region><Code2 size={21} strokeWidth={2.2} aria-hidden="true" /></span>FlowSketch</div><div className="project-meta" data-tauri-drag-region><span className="project-title" title={title} data-tauri-drag-region>{title}</span><span className="save-status" data-tauri-drag-region>{dirty ? <span className="dot" /> : projectPath ? <Check size={12} aria-hidden="true" /> : <FilePlus2 size={12} aria-hidden="true" />}{dirty ? 'Есть изменения' : projectPath ? 'Сохранено' : 'Новый проект'}</span></div></div>
      <nav className="mode-switch" role="tablist" aria-label="Режим работы" onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = mode === 'code' ? 'formatting' : 'code'; setMode(next); (event.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLButtonElement)?.focus(); } }}><button role="tab" data-mode="code" aria-selected={mode === 'code'} tabIndex={mode === 'code' ? 0 : -1} onClick={() => setMode('code')}>Код → схема</button><button role="tab" data-mode="formatting" aria-selected={mode === 'formatting'} tabIndex={mode === 'formatting' ? 0 : -1} onClick={() => setMode('formatting')}>Оформление</button></nav>
      <div className="top-actions"><button onClick={() => void save()} disabled={savePending} title="Сохранить проект · Ctrl+S">{savePending ? <LoaderCircle className="spinner" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}Сохранить</button><button onClick={() => void exportDiagram()} disabled={!current || exportPending} title={current ? 'Экспортировать актуальную схему в SVG' : 'Экспорт доступен после успешного построения текущей схемы'}><Download size={18} aria-hidden="true" />Экспорт SVG</button>{isDesktop && <div className="window-controls"><button aria-label="Свернуть окно" title="Свернуть" onClick={() => void windowAction('minimize')}><Minus size={17} aria-hidden="true" /></button><button aria-label="Развернуть окно" title="Развернуть / восстановить" onClick={() => void windowAction('maximize')}><Square size={14} aria-hidden="true" /></button><button className="close-window" aria-label="Закрыть приложение" title="Закрыть" onClick={() => void windowAction('close')}><X size={18} aria-hidden="true" /></button></div>}</div>
    </header>
    <div className="workspace">
      <aside className="rail" aria-label="Действия проекта"><button aria-label="Открыть проект" title="Открыть проект .flowsketch" onClick={() => replaceWith(openSavedProject)}><FolderOpen size={21} aria-hidden="true" /></button><button aria-label="Новый проект" title="Новый проект" onClick={() => replaceWith(newProject)}><FilePlus2 size={20} aria-hidden="true" /></button><button aria-label="Шаблоны оформления" title="Шаблоны оформления" onClick={showGallery}><Grid2X2 size={20} aria-hidden="true" /></button><button className="rail-bottom" aria-label="Помощь и ограничения" title="Помощь и ограничения" onClick={() => setHelp(true)}><CircleHelp size={20} aria-hidden="true" /></button></aside>
      <main id="main-workspace" className={`work-area mode-${mode} code-view-${mobileView}`}>
        <section className="source-panel" aria-label="Исходный код" aria-hidden={mode !== 'code'}>
          <div className="source-tabs"><button className="active" onClick={() => { setMobileView('source'); editor.current?.focus(); }}><Copy size={17} aria-hidden="true" />Вставить код</button><button onClick={() => replaceWith(openCppFile)}><FolderOpen size={17} aria-hidden="true" />Открыть .cpp</button></div>
          <div className="file-row"><FileCode2 size={16} aria-hidden="true" /><span className="filename" title={sourcePath || undefined}>{sourcePath ? fileName(sourcePath) : source === SAMPLE ? 'Пример · sum_odd.cpp' : 'Вставленный код'}</span>{dirty && <span className="dot" aria-label="Есть несохранённые изменения" />}<button className="mobile-show-diagram small" onClick={() => setMobileView('diagram')}>Схема<ArrowRight size={14} aria-hidden="true" /></button></div>
          <div className="function-row"><span className="language-badge">C++17</span><div className="function-picker"><label htmlFor="function-choice">Функция</label><select id="function-choice" value={functionId} onChange={event => selectFunction(event.target.value)} disabled={pending || (functionsRevision !== revision && functions.length > 0)}><option value="">Автоматически</option>{functionId && !functions.some(item => item.id === functionId) && <option value={functionId}>Сохранённая функция</option>}{functions.map(item => <option value={item.id} key={item.id}>{item.signature}{item.supported ? '' : ' · ограничение'}</option>)}</select></div><button title="Найти функции в текущем коде" aria-label="Найти функции" onClick={() => void runAnalysis(true)} disabled={pending || !source.trim()}><RefreshCw size={15} className={stage === 'discovering' ? 'spinner' : ''} aria-hidden="true" /></button></div>
          {!isDesktop && <div className="issue-banner">Открыт предпросмотр интерфейса. Анализ C++ и файловые диалоги доступны в десктопном приложении.</div>}
          <div className="editor-region"><CodeEditor ref={editor} source={source} onChange={changeSource} onCursor={cursorChanged} onBuild={() => void latestBuild.current()} selectedRange={current ? selectedNode?.sourceRange : null} /></div>
          {allDiagnostics.length > 0 && <details className="diagnostics" open><summary>Диагностика · {allDiagnostics.length}</summary><div className="diagnostics-list">{allDiagnostics.map((item, index) => <p className="diagnostic" key={`${item.code}-${index}`}><span className="diagnostic-code">{item.code}</span>{item.message}{item.sourceRange && <button onClick={() => { setMobileView('source'); editor.current?.reveal(item.sourceRange!); }}>Строка {item.sourceRange.begin.line}</button>}</p>)}</div></details>}
          <div className="build-footer">{pending || layoutPending ? <div className="pending-build"><button className="primary" disabled><LoaderCircle className="spinner" size={17} aria-hidden="true" />{layoutPending ? 'Размещаем блоки' : 'Разбираем код'}</button><button onClick={() => void cancel()} title="Отменить · Escape">Отмена</button></div> : <button className="primary" onClick={() => void runAnalysis()} disabled={!source.trim()}><span>Построить схему</span><span className="shortcut">Ctrl+Enter</span></button>}<div className="source-note"><Info size={15} aria-hidden="true" /><span>{current ? 'Схема построена для выбранной функции.' : stale ? 'Код изменён. Постройте схему повторно.' : 'Исходный код разбирается локально, без запуска.'}</span></div></div>
        </section>
        <section className="diagram-panel" aria-label="Блок-схема">
          <div className="diagram-heading"><div className="diagram-heading-left"><div className="responsive-switch"><button className={mobileView === 'source' ? 'active' : ''} onClick={() => setMobileView('source')} hidden={mode !== 'code'}>Код</button><button className={mobileView === 'diagram' ? 'active' : ''} onClick={() => setMobileView('diagram')} hidden={mode !== 'code'}>Схема</button></div><h2>{mode === 'code' ? 'Блок-схема' : 'Оформление схемы'}</h2>{mode === 'code' && result?.graph && <span className="subtle-label">{result.graph.nodes.length} блоков</span>}</div>{mode === 'formatting' && <div className="format-toolbar"><button onClick={showGallery}><Grid2X2 size={15} aria-hidden="true" />Шаблоны</button><button onClick={arrange} disabled={!result?.graph || layoutPending} title="Пересчитать размеры и упорядочить схему"><WandSparkles size={16} aria-hidden="true" /><span className="arrange-label">Упорядочить</span></button><button className="icon-button" onClick={undoStyle} disabled={!stylePast.length} title="Отменить оформление" aria-label="Отменить оформление"><Undo2 size={16} aria-hidden="true" /></button><button className="icon-button" onClick={redoStyle} disabled={!styleFuture.length} title="Повторить оформление" aria-label="Повторить оформление"><Redo2 size={16} aria-hidden="true" /></button><button className="icon-button properties-toggle" aria-label="Показать свойства" aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen(value => !value)}><Settings2 size={16} aria-hidden="true" /></button></div>}</div>
          <div className="canvas-wrap">{scene?.status === 'ready' ? <DiagramCanvas scene={scene} selectedNodeId={selectedNodeId} onSelectNode={selectNode} onClearSelection={() => setSelectedNodeId(null)} stale={stale} ariaLabel="Блок-схема выбранной функции" /> : <div className="empty-canvas"><div className="empty-icon"><Code2 size={29} strokeWidth={1.5} aria-hidden="true" /></div><h2>От кода к ясной схеме</h2><p>{allDiagnostics.length ? 'Исправьте отмеченные ошибки или выберите поддерживаемую функцию и повторите построение.' : 'Вставьте функцию C++ или откройте .cpp. FlowSketch построит её переходы и разместит блоки.'}</p>{mode === 'formatting' ? <button className="primary" onClick={() => setMode('code')}>Перейти к коду<ArrowRight size={16} aria-hidden="true" /></button> : <button className="primary" onClick={() => void runAnalysis()} disabled={pending || !source.trim()}>Построить схему<ArrowRight size={16} aria-hidden="true" /></button>}</div>}{(pending || layoutPending) && <div className="pending-canvas"><LoaderCircle className="spinner" size={21} aria-hidden="true" />{layoutPending ? 'Размещаем блоки…' : stage === 'discovering' ? 'Ищем функции…' : 'Строим схему…'}</div>}</div>
          <footer className="canvas-status"><span className={`status-label ${statusState}`} role="status" aria-live="polite" aria-atomic="true"><StatusIcon state={statusState} />{statusText}</span><span className="status-detail">{current ? result?.status === 'BUILT_WITH_ABSTRACTION' ? 'Схема содержит абстракции' : 'Обычные переходы внутри функции' : stale ? `Предыдущая ревизия ${result?.sourceRevision || '—'}` : 'C++17 · учебные функции'}</span><span className="status-file" title={sourcePath || ''}>{sourcePath ? fileName(sourcePath) : 'Вставленный код'}</span></footer>
        </section>
        {mode === 'formatting' && <aside className={`properties-panel ${propertiesOpen ? '' : 'collapsed'}`} aria-label="Свойства оформления"><h2>Свойства</h2><div className="properties-tabs"><button className={propertyTab === 'block' ? 'active' : ''} onClick={() => setPropertyTab('block')}>Блок</button><button className={propertyTab === 'diagram' ? 'active' : ''} onClick={() => setPropertyTab('diagram')}>Схема</button></div>{propertyTab === 'block' ? <><div className="property-section"><h3>Выбранный блок</h3>{selectedNode ? <><div className="property-row"><span>Тип блока</span><span>{nodeKindName(selectedNode)}</span></div><div className="readonly-field">{selectedNode.label}</div><p className="selected-source">{selectedNode.sourceRange?.synthetic ? 'Служебный блок алгоритма' : selectedNode.sourceRange ? `Строки ${selectedNode.sourceRange.begin.line}–${selectedNode.sourceRange.end.line}` : 'Привязка к исходнику отсутствует'}</p>{selectedNode.sourceRange && !selectedNode.sourceRange.synthetic && <button className="link-button" disabled={!current} onClick={() => { setMode('code'); setMobileView('source'); window.setTimeout(() => editor.current?.reveal(selectedNode.sourceRange!), 0); }}>Показать в коде</button>}</> : <p className="property-info">Выберите блок на холсте, чтобы увидеть выражение и строку исходника.</p>}</div><div className="property-section"><p className="property-info">Тип и выражение следуют исходному коду. Оформление всей схемы доступно на вкладке «Схема».</p><button onClick={() => setPropertyTab('diagram')}><Palette size={16} aria-hidden="true" />Оформление схемы</button></div></> : <><div className="property-section"><h3>Текст</h3><div className="property-row"><label htmlFor="font-family">Шрифт</label><select id="font-family" value="Liberation Sans" onChange={() => {}}><option>Liberation Sans</option></select></div><div className="property-row"><label htmlFor="font-size">Размер</label><select id="font-size" value={style.fontSize} onChange={event => applyStyle({ ...style, fontSize: Number(event.target.value) })}>{Array.from({ length: 13 }, (_, index) => index + 12).map(value => <option key={value}>{value}</option>)}</select></div><ColorField label="Цвет текста" value={style.textColor} onChange={value => applyStyle({ ...style, textColor: value })} /></div><div className="property-section"><h3>Цвет и линии</h3><ColorField label="Процесс" value={style.nodeFill} onChange={value => applyStyle({ ...style, nodeFill: value })} /><ColorField label="Условие" value={style.decisionFill} onChange={value => applyStyle({ ...style, decisionFill: value })} /><ColorField label="Начало и конец" value={style.terminalFill} onChange={value => applyStyle({ ...style, terminalFill: value })} /><ColorField label="Линии" value={style.lineColor} onChange={value => applyStyle({ ...style, lineColor: value })} /><ColorField label="Фон" value={style.background} onChange={value => applyStyle({ ...style, background: value })} /><div className="property-row"><label htmlFor="stroke-width">Толщина</label><select id="stroke-width" value={style.strokeWidth} onChange={event => applyStyle({ ...style, strokeWidth: Number(event.target.value) })}>{[1, 1.5, 2, 2.5, 3, 4].map(value => <option value={value} key={value}>{value} px</option>)}</select></div></div><div className="property-section"><h3>Автоматическое размещение</h3><p className="property-info">Размеры блоков подстраиваются под текст. Смена оформления пересчитывает схему, сохраняя переходы.</p><button onClick={arrange} disabled={!result?.graph || layoutPending}><WandSparkles size={16} aria-hidden="true" />Исправить размещение</button></div></>}<button className="primary" onClick={() => { setStyleName('Мой стиль'); setSaveStyleDialog(true); }}>Сохранить как шаблон</button></aside>}
      </main>
    </div>
    {notice && <div className={`notification ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><Info size={17} aria-hidden="true" /><p>{notice.message}</p><button aria-label="Закрыть уведомление" onClick={() => setNotice(null)}><X size={16} aria-hidden="true" /></button></div>}
    {gallery && <Modal title="Шаблоны оформления" className="gallery-modal" onClose={() => setGallery(false)}><div className="gallery-body"><div className="gallery-picker"><div className="gallery-filters">{[['all', 'Все'], ['recent', 'Недавние'], ['custom', 'Мои']].map(([key, name]) => <button key={key} className={galleryFilter === key ? 'active' : ''} aria-pressed={galleryFilter === key} onClick={() => setGalleryFilter(key as typeof galleryFilter)}>{name}</button>)}</div><p className="gallery-last">Последний использованный: {allStyles.find(item => item.key === library.last)?.name || 'Холодный акцент'}</p><div className="template-grid">{visibleStyles.length ? visibleStyles.map(item => <button key={item.key} className="template-card" aria-pressed={galleryKey === item.key} onClick={() => setGalleryKey(item.key)}><span className="template-name">{item.name}{galleryKey === item.key && <CheckCircle2 size={16} aria-hidden="true" />}</span><TemplateMiniature style={item.style} /><span className="template-description">{item.description}</span></button>) : <p className="gallery-empty">{galleryFilter === 'custom' ? 'Ваших шаблонов пока нет. Настройте оформление и сохраните его как шаблон.' : 'Применённые шаблоны появятся здесь.'}</p>}</div></div><div className="gallery-preview"><h3>Предпросмотр</h3><div className="gallery-preview-canvas" style={{ background: selectedStyleItem.style.background }}>{galleryScene?.status === 'ready' ? <div className="preview-svg" dangerouslySetInnerHTML={{ __html: sceneSvg(galleryScene) }} /> : <p className="preview-empty">{galleryError || 'После построения здесь появится ваша схема в выбранном оформлении.'}</p>}{galleryPending && <div className="pending-canvas"><LoaderCircle className="spinner" size={20} aria-hidden="true" />Предпросмотр…</div>}</div><p className="gallery-preview-caption">{stale ? 'Предпросмотр предыдущей ревизии. После применения потребуется обновить схему.' : 'Шаблон меняет оформление и размеры. Логика переходов сохраняется.'}</p></div></div><footer className="modal-footer gallery-footer"><small>Применение заменит общие настройки оформления. Отмена сохранит текущий вид.</small><div><button onClick={() => setGallery(false)}>Отмена</button>{' '}<button className="primary" onClick={commitTemplate} disabled={galleryPending || !!galleryError}>Применить шаблон</button></div></footer></Modal>}
    {saveStyleDialog && <Modal title="Сохранить шаблон" className="small-modal" onClose={() => setSaveStyleDialog(false)}><div className="modal-body"><label className="modal-field">Название<input autoFocus data-initial-focus value={styleName} maxLength={80} onChange={event => setStyleName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveCustomStyle(); }} /></label><p className="property-info" style={{ marginTop: 14 }}>Сохраняются цвета, шрифт и линии. Исходный код в шаблон не входит.</p></div><footer className="modal-footer"><button onClick={() => setSaveStyleDialog(false)}>Отмена</button><button className="primary" disabled={!styleName.trim()} onClick={saveCustomStyle}>Сохранить</button></footer></Modal>}
    {help && <Modal title="FlowSketch · первый прототип" className="small-modal" onClose={() => setHelp(false)}><div className="modal-body"><p className="modal-copy">Откройте .cpp, выберите функцию и постройте её блок-схему. Щелчок по блоку выделяет исходное выражение. Настройте оформление, сохраните проект и экспортируйте SVG.</p><ul className="help-list"><li>Ctrl+Enter — построить схему</li><li>Ctrl+S — сохранить проект</li><li>Escape — закрыть окно или отменить построение</li><li>Масштаб и перемещение доступны кнопками и клавиатурой на холсте.</li></ul><p className="property-info" style={{ marginTop: 16 }}>Поддержка C++ ограничена проверенным учебным профилем. Неподдерживаемые конструкции показываются в диагностике. Код не запускается. PDF и установщик — следующие этапы.</p></div><footer className="modal-footer"><button className="primary" onClick={() => setHelp(false)}>Понятно</button></footer></Modal>}
    {openChoice && <Modal title="Открыть файл" className="small-modal" onClose={() => setOpenChoice(false)}><div className="modal-body"><p className="modal-copy">Выберите исходный C++ или сохранённый проект FlowSketch.</p><div style={{ display: 'flex', gap: 12, marginTop: 18 }}><button onClick={() => { setOpenChoice(false); replaceWith(openCppFile); }}><FileCode2 size={18} aria-hidden="true" />Исходный .cpp</button><button onClick={() => { setOpenChoice(false); replaceWith(openSavedProject); }}><FolderOpen size={18} aria-hidden="true" />Проект</button></div></div></Modal>}
    {pendingReplace && <Modal title="Сохранить изменения?" className="small-modal" onClose={() => setPendingReplace(null)}><div className="modal-body"><p className="modal-copy">В текущем проекте есть несохранённые изменения. Сохраните их перед открытием другого исходника или проекта.</p></div><footer className="modal-footer"><button onClick={() => setPendingReplace(null)}>Отмена</button><button onClick={() => { const action = pendingReplace; setPendingReplace(null); void action(); }}>Не сохранять</button><button className="primary" onClick={async () => { if (await save()) { const action = pendingReplace; setPendingReplace(null); void action(); } }} disabled={savePending}>Сохранить</button></footer></Modal>}
  </div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label className="property-row"><span>{label}</span><input type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function nodeKindName(node: GraphNode) {
  return ({ terminator: 'Начало / конец', decision: 'Условие', process: 'Процесс', io: 'Ввод / вывод', call: 'Вызов', connector: 'Соединитель' })[node.kind];
}
function TemplateMiniature({ style }: { style: DiagramStyle }) {
  return <span className="template-miniature" style={{ background: style.background }} aria-hidden="true"><svg viewBox="0 0 150 120"><path d="M75 25v12m0 21v14m0 23v12" fill="none" stroke={style.lineColor} strokeWidth={style.strokeWidth} /><rect x="44" y="5" width="62" height="21" rx="11" fill={style.terminalFill} stroke={style.lineColor} strokeWidth={style.strokeWidth} /><rect x="45" y="38" width="60" height="21" fill={style.nodeFill} stroke={style.lineColor} strokeWidth={style.strokeWidth} /><path d="M75 71l33 13-33 13-33-13z" fill={style.decisionFill} stroke={style.lineColor} strokeWidth={style.strokeWidth} /><rect x="44" y="107" width="62" height="10" rx="5" fill={style.terminalFill} stroke={style.lineColor} strokeWidth={style.strokeWidth} /><text x="75" y="19" textAnchor="middle" fill={style.textColor} fontSize="8">Начало</text><text x="75" y="51" textAnchor="middle" fill={style.textColor} fontSize="8">s = 0</text><text x="75" y="87" textAnchor="middle" fill={style.textColor} fontSize="8">i &lt;= n</text></svg></span>;
}

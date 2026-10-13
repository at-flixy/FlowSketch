import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/cpp/register';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

const SOURCE_LINK_SELECTION = 'flowsketch-source-link';

// Workers are bundled locally; the desktop editor never requests a CDN.
(globalThis as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export interface EditorRange {
  begin: { offset: number; line?: number; column?: number };
  end: { offset: number; line?: number; column?: number };
  synthetic?: boolean;
}
export interface CodeEditorHandle {
  reveal(range: EditorRange, focus?: boolean): void;
  focus(): void;
}
interface Props {
  source: string;
  onChange(source: string): void;
  onCursor(byteOffset: number): void;
  onBuild(): void;
  selectedRange?: EditorRange | null;
}

export function byteOffsetToUtf16(source: string, offset: number): number {
  const bytes = new TextEncoder().encode(source);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, offset)).length;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const externalChange = useRef(false);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  function editorRange(range: EditorRange) {
    const model = instance.current?.getModel();
    if (!model) return null;
    try {
      const start = model.getPositionAt(byteOffsetToUtf16(model.getValue(), range.begin.offset));
      const end = model.getPositionAt(byteOffsetToUtf16(model.getValue(), range.end.offset));
      return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
    } catch {
      return null; // A stale or invalid UTF-8 range must never highlight unrelated text.
    }
  }

  useImperativeHandle(ref, () => ({
    reveal(range, focus = false) {
      const selection = editorRange(range);
      if (selection) {
        instance.current?.revealRangeInCenterIfOutsideViewport(selection);
        instance.current?.setSelection(selection, SOURCE_LINK_SELECTION);
        if (focus) instance.current?.focus();
      }
    },
    focus() { instance.current?.focus(); },
  }));

  useEffect(() => {
    if (!host.current) return;
    monaco.editor.defineTheme('flowsketch-graphite', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'keyword', foreground: 'A49AFF' },
        { token: 'type', foreground: '92D9E7' },
        { token: 'number', foreground: '85DDCE' },
        { token: 'comment', foreground: '8290A8' },
        { token: 'string', foreground: 'BDE4AC' },
      ],
      colors: {
        'editor.background': '#141B27', 'editor.foreground': '#E4EAF7',
        'editorLineNumber.foreground': '#8B98AF', 'editorLineNumber.activeForeground': '#E4EAF7',
        'editor.selectionBackground': '#45498280', 'editor.lineHighlightBackground': '#1C2535',
        'editorCursor.foreground': '#ABA7FF', 'editor.inactiveSelectionBackground': '#303D5F',
        'editorIndentGuide.background1': '#293348', 'editorIndentGuide.activeBackground1': '#5C628B',
      },
    });
    const editor = monaco.editor.create(host.current, {
      value: latest.current.source, language: 'cpp', theme: 'flowsketch-graphite',
      ariaLabel: 'Исходный код C++', fontFamily: "'JetBrains Mono', 'Consolas', monospace",
      fontSize: 14, lineHeight: 24, minimap: { enabled: false }, automaticLayout: true,
      scrollBeyondLastLine: false, overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
      renderLineHighlight: 'line', folding: true, tabSize: 4, wordWrap: 'off',
      padding: { top: 16, bottom: 16 }, stickyScroll: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    instance.current = editor;
    decorations.current = editor.createDecorationsCollection();
    const change = editor.onDidChangeModelContent(() => {
      if (!externalChange.current) latest.current.onChange(editor.getValue());
    });
    const cursor = editor.onDidChangeCursorPosition(event => {
      // Diagram → code ends at an exclusive range boundary; it must not trigger code → diagram.
      if (event.source === SOURCE_LINK_SELECTION) return;
      const model = editor.getModel();
      if (model) latest.current.onCursor(new TextEncoder().encode(model.getValue().slice(0, model.getOffsetAt(event.position))).length);
    });
    editor.addAction({ id: 'flowsketch.build', label: 'Построить схему', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => latest.current.onBuild() });
    return () => { change.dispose(); cursor.dispose(); editor.dispose(); instance.current = null; };
  }, []);

  useEffect(() => {
    const editor = instance.current;
    if (editor && editor.getValue() !== props.source) {
      externalChange.current = true;
      editor.setValue(props.source);
      externalChange.current = false;
    }
  }, [props.source]);

  useEffect(() => {
    const range = props.selectedRange && !props.selectedRange.synthetic ? editorRange(props.selectedRange) : null;
    decorations.current?.set(range ? [{ range, options: { className: 'source-linked-selection', isWholeLine: false } }] : []);
  }, [props.selectedRange, props.source]);

  return <div className="code-editor" ref={host} />;
});

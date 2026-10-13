import {invoke, isTauri} from '@tauri-apps/api/core';
import type {AnalyzeInput, AnalyzerResponse, ExportFormat, FlowProject} from './types';

export function desktopAvailable(): boolean { return isTauri(); }
function requireDesktop(): void {
  if (!isTauri()) throw new Error('Для анализа и работы с файлами откройте десктопное приложение FlowSketch.');
}
export async function analyze(input: AnalyzeInput): Promise<AnalyzerResponse> {
  requireDesktop();
  const result = await invoke<AnalyzerResponse>('analyze', {request: {
    source: input.source, functionId: input.functionId ?? null,
    sourceRevision: input.revision, requestId: input.requestId,
    operation: input.discoverOnly ? 'discover' : 'analyze',
  }});
  if (result.protocolVersion !== 1 || result.requestId !== input.requestId || result.sourceRevision !== input.revision)
    throw new Error('Получен результат для другой версии исходного кода. Повторите построение.');
  return result;
}
export async function cancelAnalysis(requestId: string): Promise<void> {
  requireDesktop(); await invoke('cancel', {requestId});
}
export async function openCpp(): Promise<{source: string; path: string} | null> {
  requireDesktop(); return await invoke('open_cpp');
}
export async function saveProject(project: FlowProject): Promise<string | null> {
  requireDesktop(); return await invoke('save_project', {project});
}
export async function openProject(): Promise<{project: FlowProject; path: string} | null> {
  requireDesktop(); return await invoke('open_project');
}
export async function saveExport(bytes: number[], format: ExportFormat, filename: string): Promise<string | null> {
  requireDesktop(); return await invoke('save_export', {bytes, format, filename});
}

/** Clang columns are UTF-8 bytes; Monaco positions count UTF-16 code units. */
export function editorColumn(source: string, byteOffset: number): {lineNumber: number; column: number} {
  const prefix = new TextDecoder().decode(new TextEncoder().encode(source).slice(0, byteOffset));
  const lines = prefix.split('\n');
  return {lineNumber: lines.length, column: lines[lines.length - 1].length + 1};
}

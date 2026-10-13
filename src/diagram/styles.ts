import type { DiagramStyle, TemplateId } from '../types';
import { DiagramError } from './types';

const base: DiagramStyle = {
  templateId: 'educational', fontFamily: 'Liberation Sans', fontSize: 14, strokeWidth: 1.5,
  nodeFill: '#FFFFFF', decisionFill: '#FFFFFF', terminalFill: '#FFFFFF',
  textColor: '#172033', lineColor: '#344260', background: '#FFFFFF',
};

export const templates: ReadonlyArray<{ id: TemplateId; name: string; description: string; style: DiagramStyle }> = [
  { id: 'educational', name: 'Учебный', description: 'Нейтральные фигуры и ясные переходы', style: { ...base } },
  { id: 'monochrome', name: 'Монохромный', description: 'Чёрные линии на белом фоне для печати', style: { ...base, templateId: 'monochrome', textColor: '#000000', lineColor: '#111111' } },
  { id: 'cool', name: 'Холодный акцент', description: 'Спокойный перивинкловый акцент', style: { ...base, templateId: 'cool', nodeFill: '#F8F8FF', decisionFill: '#EEF0FF', terminalFill: '#F2F3FF', lineColor: '#6068C8', background: '#F7F8FC' } },
  { id: 'contrast', name: 'Контрастный', description: 'Чёткие тёмные границы и текст', style: { ...base, templateId: 'contrast', strokeWidth: 2.5, textColor: '#050B16', lineColor: '#050B16' } },
];
export const STYLE_PRESETS = templates;
export const defaultStyle: DiagramStyle = { ...base };

export function normalizeStyle(input: Partial<DiagramStyle> = {}): DiagramStyle {
  const preset = templates.find(item => item.id === (input.templateId ?? base.templateId));
  if (!preset) throw new DiagramError('STYLE_UNKNOWN', 'Неизвестный шаблон оформления.');
  const result = { ...preset.style, ...input };
  if (result.fontFamily !== 'Liberation Sans') throw new DiagramError('FONT_UNAVAILABLE', 'В прототипе доступен поставляемый шрифт Liberation Sans.');
  if (!Number.isFinite(result.fontSize) || result.fontSize < 12 || result.fontSize > 24) throw new DiagramError('FONT_SIZE_LIMIT', 'Размер шрифта должен быть от 12 до 24.');
  if (!Number.isFinite(result.strokeWidth) || result.strokeWidth < 1 || result.strokeWidth > 4) throw new DiagramError('STROKE_WIDTH_LIMIT', 'Толщина линий должна быть от 1 до 4.');
  for (const key of ['nodeFill', 'decisionFill', 'terminalFill', 'textColor', 'lineColor', 'background'] as const) {
    if (!/^#[0-9a-f]{6}$/i.test(result[key])) throw new DiagramError('COLOR_INVALID', `Некорректный цвет: ${key}.`);
  }
  return result;
}

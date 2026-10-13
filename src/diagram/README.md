# Модуль блок-схем: браузер / WebView2

Модуль получает готовый `SemanticGraph` от нативного анализатора. Он не разбирает
C++, не исполняет исходный код и не изменяет семантические узлы или переходы.
`layoutHint: 'back'` и `role: 'back'` задают обратные переходы для раскладки;
`continue` без этой метки остаётся обычным переходом. Неизвестный цикл в прямом
графе отклоняется с `LAYOUT_CYCLE_ROLE_REQUIRED`.

## Публичный интерфейс

Импортировать из `src/diagram/index.ts`:

```ts
const controller = createLayoutController();
const scene = await controller.layoutGraph(graph, normalizeStyle({
  templateId: 'cool', fontSize: 16,
}), {
  requestId: crypto.randomUUID(), modelRevision, styleRevision,
  signal: abortController.signal, timeoutMs: 5000,
});
// scene.status === 'ready' или 'rejected' с geometry diagnostics.
const svg: Blob = exportSvg(scene);
const png: Blob = await exportPng(scene, { scale: 2, signal });
controller.dispose();
```

`layoutGraph` / `cancelLayout` используют один общий контроллер. Независимые
холсты и предпросмотры должны создавать отдельные контроллеры. Новое задание
прерывает Worker предыдущего задания; ответ с другим requestId не публикуется.
Тайм-аут включает загрузку локального шрифта. Запросы можно отменять AbortSignal.

`DiagramCanvas` принимает `scene | null`, `selectedNodeId`, `onSelectNode`,
`onClearSelection`, `stale`, `ariaLabel`, `onViewportChange`, `initialViewport`.
Он показывает точные primitives сцены и отдельный слой выбора. Tab / Enter /
пробел выбирают блок; вверх и вниз на блоке выбирают соседний блок. Стрелки на
холсте перемещают обзор, + / − меняют масштаб, Home подбирает масштаб, 0 задаёт
100%. Ctrl и колесо масштабируют около указателя; колесо и перетаскивание пустого
холста перемещают обзор. Space и перетаскивание работают поверх блоков.

`templates` (также `STYLE_PRESETS`), `defaultStyle`, `normalizeStyle` предоставляют
четыре шаблона: Учебный, Монохромный, Холодный акцент, Контрастный. Только
поставляемый Liberation Sans; размер 12–24, толщина 1–4, цвета `#RRGGBB`. Изменение
размера повторно измеряет текст и строит геометрию.

## Сцена и экспорт

API ELK и fontkit находятся внутри локального module Worker. GWT-движок ELK
работает в отдельном поставляемом classic Worker, который закрывается после
раскладки. Window предварительно загружает bytes этого локального asset и
передаёт Blob URL наружному Worker; nested Worker читает Blob, обходя
[ошибку custom protocol WebView2/Tauri](https://github.com/tauri-apps/tauri/issues/15755).
Blob URL освобождается после завершения, ошибки, отмены или тайм-аута. CSP не
ослабляется: используются существующие `worker-src 'self' blob:`.
`elk.bundled` не применяется внутри браузерного Worker: его fallback
не создаётся в этом окружении. Шрифт загружается
из поставляемого TTF; метрики и контуры получаются из одних bytes. `graphDigest`,
`styleDigest`, `sceneDigest`, modelRevision и styleRevision позволяют оболочке
сопоставить сцену с текущим кодом и оформлением. Перед экспортом оболочка должна
проверить актуальные ревизии; сам модуль не знает текущий текст редактора.

`sceneSvg(scene)` и `exportSvg(scene)` экспортируют те же primitives, что холст:
текст представлен векторными контурами, не зависит от системных шрифтов.
Оригинальные Unicode-подписи, диапазоны исходного кода, связи, ревизии и hash
шрифта находятся в metadata. Выделение, сетка, панорамирование и элементы UI
в экспорт не попадают. SVG не содержит foreignObject и сетевых ресурсов.

PNG использует этот SVG и браузерный Canvas2D. Ограничения проверяются до
выделения поверхности: 16384 пикселя по стороне, 64 млн пикселей суммарно,
масштаб 1× / 2× / 3×. Ошибка и отмена освобождают URL и canvas. Очень большую
сцену можно сохранить в SVG; масштаб PNG не снижается автоматически.

Экспорт отклоняет rejected-сцену и повторно проверяет её геометрию. Сцены
создаются этим Worker; сериализованная пользовательская сцена не является
поддерживаемым входом. Нативный проект должен хранить граф и оформление.

PDF в этом браузерном модуле пока отсутствует. Stage 1 PDF-экспорт остаётся
отдельным Node spike, его нельзя импортировать в WebView2. Дополнительно нужны
production gates для широких / сложных графов, чистой установки и всех DPI.
Пересечения и частично общие трассы между связями пока не имеют jump-bridge
обозначений. Минимум обзора 10% ограничивает fit для очень широких сцен.

## Проверки

```powershell
npx.cmd vitest run src/diagram
npx.cmd tsc --noEmit
```

Pure tests используют реальные bytes TTF, ELK и существующие 21 граф Clang.
Проверяют сохранение семантических данных, порядок начала, порты и трассы,
контуры текста внутри фигур, детерминизм, повторное измерение 12/24, обязательную
feedback-метку, отказ экспорта плохой геометрии и лимиты PNG. Транспортные mocks
используются только в unit tests отмены Worker, не в API приложения.

Для реальной браузерной проверки открыть при работающем Vite:
`http://127.0.0.1:1420/src/diagram/browser-harness.html`. Это dev-only страница
готового графа из реального Stage 1 Clang, не заглушка C++-анализатора.
`window.__diagramHarness` предоставляет build, snapshot, svg и png для проверки
локального Worker и фактического PNG. Страница не входит в production App.

Production-версия этого же harness и реальная WebView2-проверка:

```powershell
npx.cmd vite build --config src/diagram/harness.vite.config.ts
npx.cmd vite preview --config src/diagram/harness.vite.config.ts
# При запущенном Vite dev и Tauri webdriver feature на порту 4447:
node src/diagram/browser-verify.mjs
```

Результаты записываются в `spikes/tauri/diagram-browser`. Проверка использует
реальные browser Promises и независимые sync polling команды WDIO; async-script
callback для preview origin не завершается в используемом WDIO bridge. Она
сравнивает dev/production scene digest, сохраняет SVG и PNG 1×/2×, проверяет
отмену предыдущего Worker и возвращает окно к `http://tauri.localhost/`.
Это отдельная проверка browser runtime; анализ C++ и экспорт через нативный
диалог проверяет общий Tauri E2E проекта.

## Лицензии

`fonts/LiberationSans-Regular.ttf` поставляется без изменения; лицензия OFL 1.1
лежит рядом в `fonts/LICENSE_LIBERATION.txt`. Notices npm-зависимостей и нативного
анализатора собирает общий packaging pipeline проекта. Документация:
[ELK](https://github.com/kieler/elkjs),
[fontkit](https://github.com/foliojs/fontkit).

# Layout / export spike

Это отдельный воспроизводимый эксперимент, без UI, Tauri и анализа C++.
Ручные fixtures проверяют cycle + continue, switch/fallthrough, nested branches,
длинный русский текст и синтетические графы на 50/200 блоков.

Из корня проекта:

```powershell
npm ci
npm run test:layout-export
npm run spike:layout-export
node spikes/layout-export/observe.mjs
```

Для только одного изменившегося примера:

```powershell
npm run spike:layout-export -- --only=sumOdd-continue
```

`run.mjs` ищет bundled Python/Poppler в стандартном Codex runtime. На другой
машине можно задать `FLOWSKETCH_PYTHON` и `FLOWSKETCH_PDFTOPPM`. Python должен
содержать pypdf и Pillow. npm dependencies зафиксированы package-lock.json.

API для реального analyzer adapter:

```js
import { layoutGraph, exportScene } from '../layout-export/index.mjs';
const scene = await layoutGraph(graph, { timeoutMs: 5000 });
if (scene.status !== 'ready') throw new Error(JSON.stringify(scene.diagnostics));
const exports = await exportScene(scene, outprefix, { pngScale: 1 });
```

Граф: `{id,title,nodes:[{id,kind,label,sourceRange}],edges:[{id,source,target,label,role,layoutHint?}]}`.
Типы узлов: terminator/process/decision/io/call/connector. Обратные переходы
цикла отмечаются `role:'back'` либо отдельным `layoutHint:'back'`, когда смысловой
role остаётся continue/true. Это часть контракта analyzer. Например while
continue→header является feedback; do-while continue→нижняя проверка и for
continue→increment — forward. После исключения feedback только из определения
порядка узлов forward graph должен быть DAG.
Неизвестный неаннотированный цикл возвращает `LAYOUT_CYCLE_ROLE_REQUIRED`.
Все исходные edges остаются в ELK и итоговой сцене; модель не меняется.

ELK работает в Node worker thread с timeout. Фиксированные порты и orthogonal
routes применяются к измеренным фигурам. Для cycle breaking используются
forward topological model order и MODEL_ORDER: обычный GREEDY располагал тело
sumOdd выше Начала/проверки. Это обнаружено визуально и исправлено; regression
проверяет порядок entry → loop condition → body.

Размеры текста измерены fontkit по bundled Liberation Sans Regular. Длинная
проза переносится по словам, только чрезмерно длинный непрерывный токен — по
символам. Ромб использует безопасную внутреннюю область, а не всю ширину bbox.
Проверяются glyph bounds внутри настоящего polygon, коллизии фигур, routes
через посторонние фигуры, подписи и orthogonality. observe.mjs отдельно
проверяет порты на границе фигуры и направленность forward edges.

SVG, PDF и PNG строятся из одних scene path primitives. Весь текст превращён
в контуры из тех же fontkit glyphs. Внешние/системные шрифты не используются;
SVG metadata сохраняет исходные Unicode labels и digests. PDF имеет векторные
контуры, текст не выделяется/не ищется. PDFKit напрямую рисует эти paths:
SVG-to-PDFKit не нужен; его upstream объявлен unmaintained.

verify_exports.py независимо читает PDF (bounds, single page, no raster XObjects),
рендерит Poppler при 96 DPI и сравнивает dark foreground с PNG resvg.
Разная anti-aliasing допускается: IoU >= 0.85. Это проверка геометрии экспорта,
не OCR и не доказательство семантики C++. Кириллица дополнительно проверяется
font glyph coverage, Unicode metadata readback и визуальным просмотром.

Результаты: `evidence/report.json`, `.scene.json`, `.svg`, `.pdf`, `.png` и
`.pdf-render.png`. Все шесть исходных graphs сохраняют counts и дают
детерминированную сцену в двух повторениях; это не 20-run NFR p95.
Пять графов прошли все три формата и independent rendering. Нагрузка 200
блоков геометрически допустима, но разрослась до 15899×4776; PNG 1x отклонён
по пределу 64 млн pixels. Сохранены только SVG/PDF. Размер шрифта/масштаб PNG
не уменьшался ради скрытого обхода лимита. Это открытый gap компактности.

Один bounded эксперимент `targeted-distributed-ports.mjs` (отдельные safe
fixed ports) дал 15020×6052 и тоже превысил raster limit. Его результат:
`evidence/distributed-ports-report.json`. Этот вариант не принят по умолчанию.
Следующее исследование: structured region / compound layout и workload,
полученный из репрезентативного C++, а не high-fanout synthetic DAG.

PDF здесь single native-sized page с 1 logical px = 0.75 pt. A4/A3 pagination,
9pt minimum и boundary connectors ещё не реализованы. Размер PDF page проверяется
до записи (<=14400pt); PNG <=16384 по стороне и <=64 млн pixels. Locked positions,
повторное применение стилей, edge-crossing bridges, браузерный renderer и
Tauri packaging этим экспериментом не подтверждены.

Primary docs:

- [ELKjs](https://github.com/kieler/elkjs)
- [ELK model order cycle breaking](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-cycleBreaking-strategy.html)
- [Fontkit metrics and glyph paths](https://github.com/foliojs/fontkit)
- [PDFKit vector paths](https://pdfkit.org/docs/vector.html)
- [resvg-js](https://github.com/thx/resvg-js)

Font license и notices находятся в fonts/ и THIRD_PARTY_NOTICES.md.

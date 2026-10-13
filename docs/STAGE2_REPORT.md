# FlowSketch — первый рабочий прототип Tauri

13 октября 2026. Вертикальный срез **ACC-05 выполнен в настоящем окне Tauri / Windows WebView2: 16/16 шагов PASS**, без заглушек анализатора, графа и раскладки. Исходный C++ не компилируется в исполняемую программу и не запускается. Полная приёмка первой версии ещё не выполнена.

## Что работает

- Monaco с локальными worker и шрифтами: вставленный код и UTF-8 `.cpp`, поиск и выбор функции.
- Native Clang LibTooling: AST выбранной функции, реальный `CFG::buildCFG`, семантические блоки и переходы. Полный AST стандартных заголовков не отправляется интерфейсу.
- Общая сцена: размеры по метрикам Liberation Sans, ELK, проверка геометрии, SVG-холст, масштаб и панорамирование.
- Привязка блока к исходному диапазону UTF-8 bytes с переводом в UTF-16 Monaco. Программное выделение не сбрасывает выбранный блок; пользовательские движения курсора обновляют обратную привязку.
- Режим оформления, четыре встроенных шаблона, локальная библиотека последних/пользовательских стилей, предпросмотр, Undo/Redo и автоматическое размещение. Раскладка не меняет исходные узлы и связи.
- `.flowsketch` schemaVersion 1: код, функция и стиль; сохранение через временный файл, резервная `.flowsketch.bak`. При открытии проекта граф строится заново. Повреждённый проект не заменяет исходник.
- SVG из тех же контуров, что холст, с Unicode-подписями, диапазонами, переходами, ревизиями и hash шрифта в metadata. Экспорт доступен только для актуальной схемы.
- Rust фоновые команды, ограниченный JSON-протокол, source/context digests и request/revision guard. Windows Job Object назначается при suspended process до запуска анализатора: 1 GiB, 15 секунд, ограниченные stdin/stdout/stderr, отмена и завершение дерева.
- Нативные файловые диалоги с родительским окном, кнопки окна, защита несохранённых изменений, клавиатурные команды и компактный интерфейс.

## Проверки и свидетельства

| Проверка | Результат | Свидетельство |
| --- | --- | --- |
| Native LibTooling corpus | 47/47 PASS; реальные AST/CFG, позитивные и отрицательные случаи, UTF-8/UTF-16 и протокол | `native/analyzer/tests/evidence.json` |
| Rust host | **12/12 PASS**, including path regression; 0.59 s test runtime в финальном повторе | `spikes/tauri/evidence/rust-tests.txt` |
| Браузерная сцена | 12/12 Vitest PASS, включая 21 реальный граф этапа 1 и освобождение Blob URL | `npm run test` |
| Отдельный header runtime без bin/SDK/libs | 6/6 PASS, 4077 header files / 124654972 B | `spikes/tauri/runtime-review/evidence.json` и `manifest.json` |
| Реальный WebView2 dev/production harness | сцены равны, SVG и PNG 1×/2× реально записаны; отмена подтверждена | `spikes/tauri/diagram-browser/webview2-browser-evidence.json` |
| Встроенное Tauri окно, ACC-05 и регрессии | **16/16 PASS**, `http://tauri.localhost/`, JS errors 0 | `spikes/tauri/evidence/report.json` |
| Responsive / клавиатурный UI | 1440×900, 1100×768, 640×480; галерея/фокус/история; наблюдения разделены от native тестов | `spikes/ui/REPORT.md`, `spikes/ui/evidence` |

ACC-05 открыл настоящий UTF-8 `.cpp` с `sumOdd` (`if` + `for` + `continue`), нашёл две функции, построил и показал схему, переключил функции с кешем, проверил `continue → ++i` независимым ожиданием, разобрал bundled `iostream/cmath` через Rust Job Object, выбрал блок и выделил его в Monaco, изменил шаблон и размер шрифта, сохранил и перечитал SVG и проект, подтвердил backup, открыл проект и перестроил его. Затем реальное событие ввода Monaco EditContext сделало схему устаревшей и отключило экспорт; синтаксически неверный C++ и повреждённый проект получили явные ошибки.

В test build автоматизирован **только выбор пути** в папке `spikes/tauri/evidence`; чтение, проверка и запись файлов, IPC, Clang, Job Object, worker, сцена и SVG остаются настоящими. Интерактивный системный file picker этим E2E не автоматизирован. Test feature `webdriver`, runtime_info, глобальный Tauri test API и fixture path selector исключены из обычной сборки.

Снимки встроенного окна: `01-code-native.png`, `02-formatting-native.png`, `03-gallery-native.png`, `04-stale-native.png`, `05-error-native.png`. SVG после оформления: `spikes/tauri/evidence/diagram.svg`. Прочитан и визуально проверен реальный холст и оформление; текст/стрелки не обрезаны в проверенном размере окна.

## Обычная поставка

**Обычная сборка и smoke-проверка переносимой папки завершены.** `FlowSketch.exe` без test feature запущен из `prototype/windows-x64`, построил 10 блоков, открыл режим оформления/галерею, изменил размер текста и подтвердил диалог несохранённых изменений при закрытии; JS errors 0. Свидетельство: `spikes/tauri/evidence/ordinary-prototype-report.json`, снимок `06-ordinary-prototype.png`.

Executable 17660928 B, SHA256 `37e0924e4145a0f45837ce94d5b2831a04d4fa805702a65af9f2ea27562adfb4`. Payload без manifest: **4805 файлов / 181182434 B**. SHA каждого из 4077 headers независимо сопоставлен с pinned profile; analyzer SHA совпал с native evidence; test-only markers в обычном exe отсутствуют. `spikes/tauri/evidence/package-verification.json` фиксирует состав. Manifest лежит рядом с exe. Архив: `prototype/FlowSketch-0.1-prototype-windows-x64.zip`.

Папка `prototype/windows-x64` содержит `FlowSketch.exe`, `analyzer/flowsketch-analyzer.exe`, два полных дерева заголовков `toolchain/include` и `toolchain/lib/clang/23/include`, notices и manifest с hash каждого файла. Интерфейс, шрифты и worker встроены в executable. Node.js, Rust, Clang compiler.exe и SDK не входят в поставку и не нужны для запуска; используется установленный WebView2.

Normal build: `pwsh -NoProfile -File scripts/tauri.ps1 build`; packaging: `pwsh -NoProfile -File scripts/package-prototype.ps1`. Заголовки копируются целыми разрешёнными деревьями, не dependency closure одной демонстрационной функции. Notices сохраняют лицензии LLVM/MinGW, статических zlib/zstd, шрифтов, frontend closure и Cargo registry packages (superset с build/non-Windows компонентами). Известные upstream MIT full-text gaps fontkit/brotli/dfa сохранены явно в `docs/distribution-notices/upstream-extra.json`; полный release SBOM остаётся отдельной задачей.

## Исправления, найденные реальным окном

1. Tauri resource_dir с Windows `\\?\` не принимался Clang include paths. Граница Rust → Clang переводит trusted путь в обычную форму с `/`; регрессия включает кириллицу, пробелы и UNC.
2. `elk.bundled` внутри уже созданного Worker не экспортировал fallback constructor. Используется `elk-api` и отдельный поставляемый classic ELK Worker.
3. Packaged WebView2 не загружал вложенный Worker через custom protocol. Это соответствует [Tauri issue 15755](https://github.com/tauri-apps/tauri/issues/15755). Window заранее читает только imported local ELK asset, передаёт Blob URL в worker и освобождает его при success/error/abort/timeout. CSP не ослаблена. Прямой app-origin probe подтвердил main asset и nested Blob; полный ACC-05 подтвердил реальную цепочку после исправления.
4. При выборе кешированной функции прежняя сцена могла временно считаться текущей. Сцена сбрасывается до публикации новой модели.
5. Programmatic Monaco selection ставил курсор на endExclusive и сбрасывал выбранный блок. Source-tag выделения отделяет программный переход от пользовательского движения курсора.
6. Timing test тайм-аута ошибочно учитывал компиляцию собственного Rust fixture. Она вынесена до начала измерения native job; финальная suite 12/12 PASS. Один повтор под параллельным packaging IO превысил жёсткий 1 s cancel timing assertion; логическая отмена вернулась правильно. Это не доказательство p95 под нагрузкой — performance budgets остаются отдельной проверкой.

## Воспроизведение

Из корня проекта после установки pinned npm/Rust/toolchain:

```powershell
pwsh -NoProfile -File scripts/verify-stage2.ps1
```

Настоящий встроенный Windows E2E:

```powershell
pwsh -NoProfile -File scripts/tauri.ps1 webdriver
# Рядом с src-tauri/target/debug/flowsketch.exe разместить analyzer и toolchain
# в том же составе, который создаёт scripts/package-prototype.ps1.
$env:TAURI_WEBDRIVER_PORT = '4447'
$env:FLOWSKETCH_TEST_DIRECTORY = (Resolve-Path spikes/tauri/evidence).Path
Start-Process src-tauri/target/debug/flowsketch.exe
node scripts/tauri-e2e.mjs
```

Для обычного exe smoke-тест использует временно включённый WebView2 CDP и `scripts/prototype-smoke.cjs`; он не требует test feature. На другом компьютере путь к тестовой Playwright библиотеке задаётся `FLOWSKETCH_PLAYWRIGHT_MODULES`. CDP включается только окружением тестового запуска; в обычном запуске диагностический порт не открывается.

Для пересборки notices: Cargo metadata `--manifest-path src-tauri/Cargo.toml --offline --format-version 1` сохранить в `spikes/tauri/cargo-metadata.json`, затем `node scripts/collect-notices.mjs`. Версионированные supplemental upstream artifacts в `docs/distribution-notices` сохраняются. Header manifest и bootstrap scripts фиксируют версии, источники и hashes.

## Граница приёмки и следующий этап

Это **scalar vertical slice**, а не обещание обработки любого C++17. Поддержаны обычные переходы функций: объявления, выражения, ветви, циклы, switch, break, continue, return и атомарные вызовы с явным покрытием. Макросы, RAII/классы, overloaded operators, exceptions, indirect calls, selected templates, range-for и неизвестный compile context остаются явными ограничениями. Стандартные заголовки читаются, но string/vector/iostream semantic profiles ещё не реализованы.

Полная T01–T50 матрица, statements wrapper, structured regions и компактность 200 блоков, PNG/PDF UI и многостраничный PDF, миграции/восстановление проектов после сбоя, две темы/DPI/reduced motion на ОС, p95/startup budgets и чистые Windows 10/11 без dev tools/сети остаются задачами. Офлайн-установщик и clean-Windows gate не объявлены выполненными на машине разработчика.

Следующий рекомендуемый этап — **SEMANTICS-01**: сопоставить T01–T50 с текущей реализацией и независимыми ожиданиями, затем добавить учебные IO/массивные/string/vector профили и необходимые контексты, сохраняя явные unsupported cases. Общий список: [FlowSketch roadmap](../ROADMAP.md).

# FlowSketch roadmap / План разработки

Status: 13 October 2026. Stages 1 and 2 are complete on the developer machine; **17 of the original 25 tasks are complete**. Full v1 acceptance remains open. The next recommended task is **SEMANTICS-01**.

This file is the public source of task status. Keep stable IDs in issues and pull requests, and include evidence before checking an item. The specification and reports live in [docs](docs). A successful subset or local run does not complete a broader acceptance gate.

## Completed foundation and remaining v1 work

- [x] BASE-01 Подготовить полное ТЗ первой версии — завершено и принято пользователем.

- [x] BASE-02 Создать и согласовать три дизайн-макета — завершено и принято пользователем.

- [x] SETUP-01 Создать рабочую папку проекта и правила продолжения из других чатов — выполнено: Git, README, AGENTS.md, указатель TODO.md, копии ТЗ и макетов.

- [x] CLANG-01 Проверить portable Clang и стандартные заголовки — выполнено: llvm-mingw 20261006 / Clang 23.1.3, SHA256 архива подтвержден, iostream/vector/string/algorithm/cmath разобраны с очищенным окружением и bundled include-путями. Свидетельство: spikes/clang/evidence.json. Чистая VM — PACKAGE-01.

- [x] CLANG-02 Получить реальный AST и CFG — выполнено: основной корпус 20/20, включая 14 графов, плюс 7/7 отдельных feedback-проверок. Проверены continue, break, switch fallthrough, &&/||, return и пустые циклы. Это не вся матрица T01–T50. Команда: node spikes/clang/run-spike.mjs.

- [x] CLANG-03 Зафиксировать воспроизведение, источники, версии и ограничения — выполнено: toolchain.json, REPORT.md, evidence.json, bootstrap-toolchain.ps1; offsets/columns явно UTF-8 bytes. Native protocol и UTF-16 mapping остаются задачами следующих этапов.

- [x] LAYOUT-01 Проверить ELK на циклах, ветвях и русском тексте — выполнено: 6/6 геометрических fixtures, 21/21 реальных Clang-графов через layout, 10/10 регрессионных тестов. Исправлен порядок условия/тела; role и layoutHint разделены. Свидетельство: docs/clang-layout-stage1.json; компактность 200 блоков — LAYOUT-02.

- [ ] LAYOUT-02 Улучшить компактность больших схем через structured regions; проверить репрезентативные C++ графы на 200 блоков без уменьшения шрифта. Текущий synthetic PNG 1x превышает лимит; векторный экспорт работает.

- [x] EXPORT-01 Построить SVG/PDF/PNG из одной сцены — выполнено: 5 полных геометрических комплектов и 2/2 C++ интеграции; для 200 блоков SVG/PDF созданы, PNG 1x явно отклонен по лимиту 64 млн пикселей. PDF векторный, одностраничный; текст в контурах. Свидетельства: layout-export/evidence/report.json и docs/integration-stage1.json.

- [x] QA-01 Выполнить первичные проверки переносов, кириллицы, портов, маршрутов и детерминизма — выполнено: 15/15 регрессионных тестов, независимый Poppler/PDF readback и визуальный просмотр. Эталон sumOdd вручную проверяет continue→increment, return и ветви. NFR p95, интерактивность и DPI остаются отдельными задачами.

- [x] DECISION-01 Выпустить результат этапа 1 — выполнено: docs/STAGE1_REPORT.md, README и scripts/verify-stage1.ps1. Сохраняем кандидат Tauri 2 + React/TypeScript + Clang + ELK и общий рендерер сцены. CLI AST/CFG — эксперимент; native протокол и runtime экспорта проверяются при создании прототипа.

- [ ] PACKAGE-01 Проверить анализатор и заголовки на чистой Windows без dev tools и сети — отдельная проверка поставки.

- [x] TAURI-01 Подготовить локальный Rust и проверить Windows build tools/WebView2 — выполнено: project-local Rust/Cargo 1.99.0, Windows/MSVC/SDK/WebView2 проверены, обычный exe собран. docs/rust-toolchain.json; scripts/tauri.ps1 build.

- [x] ANALYZER-01 Реализовать native Clang LibTooling sidecar и ограниченный версионированный JSON-протокол — выполнено для scalar vertical slice: реальные AST/CFG, UTF-8/UTF-16, VFS, source/context digest, 47/47 native checks. Rust Job Object/1 GiB/15 s/отмена и протокол — 12/12 PASS. Свидетельства: native/analyzer/tests/evidence.json и spikes/tauri/evidence/rust-tests.txt. Полная семантика — SEMANTICS-01.

- [x] TAURI-02 Собрать первый рабочий Windows-прототип с редактором C++, открытием .cpp и схемой — выполнено: настоящий Tauri/WebView2, Monaco, native analyzer, bundled headers и scene. prototype/windows-x64/FlowSketch.exe; архив prototype/FlowSketch-0.1-prototype-windows-x64.zip; ordinary-prototype-report.json и archive-verification.json. Чистая Windows — PACKAGE-01.

- [x] TAURI-03 Добавить переход между блоком и строками кода и защиту от устаревшего результата — выполнено: UTF-8 bytes → UTF-16 Monaco, programmatic source-link tag, собственная scene для кешированной функции; реальный ввод делает схему устаревшей и отключает SVG. Проверено в native E2E 16/16.

- [x] TAURI-04 Подключить режим оформления и выбранную визуальную систему — выполнено: graphite/periwinkle, четыре стиля, свойства, auto layout, галерея и предпросмотр реального графа. Node/edge/source metadata и graphDigest сохраняются при смене шаблона/шрифта. Снимки 01–03 в spikes/tauri/evidence.

- [x] TAURI-05 Подключить сохранение проекта и экспорт прототипа — выполнено: schemaVersion 1 .flowsketch, atomic save, backup, reopen требует rebuild; реальный SVG с общей сценой и metadata. Readback и negative cases PASS. PNG/PDF UI — EXPORT-02.

- [x] TAURI-06 Проверить рабочий вертикальный срез по ACC-05 — выполнено: настоящий embedded app origin http://tauri.localhost, 16/16 E2E steps PASS, JS errors 0. В тестовой сборке автоматизирован только выбор file path; IO/Clang/Job/worker/scene/SVG реальные. Обычный exe без test feature отдельно smoke-tested. docs/STAGE2_REPORT.md и spikes/tauri/evidence/report.json.

- [ ] SEMANTICS-01 Реализовать и проверить всю матрицу 50 случаев, отдельные ограничения и профили абстракций — следующий этап: сопоставить T01–T50 с current native corpus и независимыми ожиданиями; затем учебные IO/массивы/string/vector и необходимые контексты. 47 native checks не заменяют матрицу приёмки.

- [ ] STYLE-01 Реализовать встроенные, последние и пользовательские шаблоны с отменой изменений — базовый вариант уже работает в прототипе (4 presets, local last/custom library, preview, Undo/Redo). Полная приёмка требований библиотеки/постоянства/ошибок — следующий этап.

- [ ] PROJECT-01 Реализовать версии файлов, backup и восстановление после сбоев — schemaVersion 1, atomic save, backup и защита от повреждённого проекта проверены в прототипе. Миграции и crash recovery ещё предстоят.

- [ ] EXPORT-02 Довести многостраничный PDF, ограничения PNG и метаданные покрытия — SVG работает в приложении, actual PNG 1x/2x подтверждён в WebView2 scene harness. PNG/PDF UI, A4/A3/pagination и итоговая приёмка остаются открыты.

- [ ] WINDOWS-01 Проверить две темы, DPI, клавиатуру и reduced motion — dark UI/keyboard/responsive 1440/1100/640 проверены, native window наблюдалось при DPR 1.25. Light theme, матрица DPI, native file-picker QA и OS reduced-motion переключение ещё предстоят.

- [ ] RELEASE-01 Собрать офлайн-установщик, выполнить итоговую приемку и оформить отчет.

## Open-source publication

- [x] OSS-01 Publish the original source under MIT, preserve upstream licenses, add bilingual documentation, portable graph fixtures and public-checkout CI.
- [ ] OSS-02 Complete dependency source/notice audit and publish a verified Windows binary release (also PACKAGE-01 / RELEASE-01).

Historical task wording refers to local artifacts, which can be reproduced with the build guide. Local executables and ZIPs are not downloadable releases. See [publication provenance](docs/PUBLICATION.md).

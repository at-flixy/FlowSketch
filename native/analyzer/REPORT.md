# Нативный анализатор: вертикальный срез этапа 2

Проверено 13.10.2026: **47/47 native-проверок PASS**. Анализатор собран как Windows x64 executable; использует реальные Clang LibTooling AST и `CFG::buildCFG`, без запуска исходного C++ и без CLI AST JSON.

## Воспроизведение

Из корня FlowSketch:

```powershell
./scripts/bootstrap-clang-sdk.ps1
./scripts/build-analyzer.ps1
node native/analyzer/tests/run.mjs
```

Сборка требует установленного MSVC x64 build environment. Скрипт использует официальный SDK `clang-cl`, CMake/Ninja и инициализирует окружение VS только для своего процесса; в `finally` восстанавливает его. Постоянный PATH/реестр не меняются. SDK и build-only библиотеки находятся в `tools/clang-sdk`.

Executable: `native/analyzer/build/bin/flowsketch-analyzer.exe`, 35,268,096 bytes, SHA256 `6eb05851a9d0f0c27313cfe6e0f3ac5af18ed57b310be1848faf61c3ea9c2668`.

`llvm-readobj --coff-imports` подтверждает только Windows DLL: KERNEL32, ADVAPI32, ntdll, VERSION, OLEAUT32, ole32, SHELL32. LLVM/Clang, zlib, zstd и CRT слинкованы статически; отдельные сторонние DLL не требуются. Это проверка данного exe на машине разработчика; clean-Windows/offline gate ещё не пройден.

## Протокол

Trusted invocation:

```text
flowsketch-analyzer.exe --toolchain-root <проверенный bundled llvm-mingw root>
```

Текущий профиль — `tools/llvm-mingw-20261006-ucrt-x86_64`, Clang headers 23.1.3, target `x86_64-w64-windows-gnu`, C++17. Путь и параметры не берутся из пользовательского JSON. LibTooling получает фиксированный массив аргументов, `--no-default-config`, `-nostdinc/-nostdinc++`, три bundled include-root и `-fsyntax-only/-Werror=return-type`. Использование `bin/clang++.exe` как argv[0] определяет driver mode; этот compiler process не запускается.

На stdin передаётся один UTF-8 JSON до EOF:

```json
{
  "protocolVersion": 1,
  "operation": "analyze",
  "requestId": "request-123",
  "sourceRevision": 7,
  "sourceDigest": "SHA256 UTF8 исходного текста",
  "contextDigest": "digest фиксированного профиля",
  "source": "int f(int n){return n;}",
  "functionId": "f(int)"
}
```

`operation` может быть `discover` или `analyze` (по умолчанию). Discover возвращает `DISCOVERED`, список sourced функций `{id,name,signature,sourceRange,supported,unsupportedReason?}`, без графа. Analyze выбирает `functionId`; без него выбирается поддерживаемый `main`, затем первая поддерживаемая функция. Выбор происходит до построения графа и сериализации. Body/header AST целиком не сериализуется.

Ответ повторяет `protocolVersion/requestId/sourceRevision/sourceDigest/contextDigest`, содержит `analyzerVersion/status/functions/functionId?/graph?/diagnostics/coverage/elapsedMs`, а для успешного графа `cfgSummary`. Граф вложен в `graph`, форма `{id,title,nodes,edges,status,entryId,exitId,abstractions,coverage}`. Source-mapped nodes содержат `originalText` и AST kind. Для synthetic nodes `originalText=null`, `sourceRange.synthetic=true`.

Статусы среза: `BUILT_NORMAL_FLOW`, `BUILT_WITH_ABSTRACTION`, `UNSUPPORTED`, `INPUT_ERROR`, `FAILURE`; `DISCOVERED` — отдельный служебный статус. Поддерживаемый direct opaque call включает native callee name/signature/noReturn/definitionAvailable и явно выводит внутренние, исключительные и lifetime пути из покрытия. Неизвестный/indirect call и объектные операции остаются unsupported. Negative responses не содержат partial ready graph.

Обычные структурированные ответы, включая ошибки разбора, unsupported и валидные protocol negatives, завершаются exit 0. Invalid trusted CLI — exit 2; wire >1MiB отклоняется до разбора с exit 1. stdout содержит один JSON; служебные счётчики Clang могут идти на stderr. Ограничение stdout 16MiB. Source: 256KiB/5000 строк; graph: 500 узлов/1000 рёбер; control nesting: 24; expression depth: 128; source function discovery: 128 функций. Rust backend дополнительно владеет timeout/cancel/memory/process tree.

`sourceRange.begin/end.offset` и `column` — UTF-8 **байты**, line/column однобазные, end exclusive; `offsetEncoding/columnEncoding='utf8-bytes'`. `begin/end.utf16Column` дают координаты Monaco. Кириллица и emoji перед оператором проверяются отдельным независимым пересчётом из исходного Buffer.

Source хранится в in-memory VFS. Read-only overlay разрешает чтение только bundled header roots, проверяя также resolved real path; локальные/project/absolute user includes вне профиля не открываются. Отдельный negative с `C:/Windows/win.ini` подтверждает отказ. Несуществующий header внутри bundled directory возвращает ENOENT, чтобы Clang продолжал поиск в остальных разрешённых include-root.

## Семантические проверки

В срез входят обычные scalar declarations/expressions, if/else и if-init, for/while/do, switch/fallthrough/default/no-match, ближайший break, continue, return/main implicit return, встроенные short-circuit `&&/||` в условиях и их логическое отрицание. Expressions и ternary, не раскрываемые в отдельные control nodes, сохраняются атомарно в исходной записи; это не доказательство runtime поведения.

47 проверок — экспериментальный native corpus, **не T01–T50 приёмки**. Он включает исходные 20 fixtures с актуальными native ожиданиями, 7 feedback fixtures, discover/select, full callee metadata, direct noreturn terminal, UTF-8/UTF-16, 9 negative semantic/context guards, 4 protocol/limit guards и 3 дополнительных регрессии.

- Approved sumOdd проходит независимый source-level oracle из `spikes/integration/verify-sum-odd.mjs`: init один раз, `continue → ++i`, инкремент → условие, correct yes/no, return → End.
- While continue несёт `role:'continue', layoutHint:'back'`; do continue идёт к нижнему условию без feedback hint; for без increment возвращается к header с feedback. Labels и semantic targets сохраняются.
- После удаления только `role:'back'`/`layoutHint:'back'` все положительные графы образуют DAG. Пустые циклы, short-circuit feedback и trailing NullStmt проверены отдельно.
- Switch fallthrough и switch внутри цикла сохраняют цель continue окружающего цикла и ближайшую цель break.
- Syntax error/missing non-void return → INPUT_ERROR; macros/volatile/RAII/classes/overloaded logical operators/try/goto/indirect calls/deep nesting → UNSUPPORTED с диагностикой, без ready graph.
- `iostream/vector/string/algorithm/cmath` реально разбираются через bundled headers при очищенных INCLUDE/CPATH variables; их семантический graph-profile ещё не реализован, поэтому fixture возвращает UNSUPPORTED.

Граф строится из selected AST; настоящий Clang CFG строится отдельно с отключёнными EH/implicit destructor edges и без pruning trivially-false edges. Его block/edge summary подтверждает CFG extraction. Автоматическое доказательство полной эквивалентности графа всем Clang CFG elements не заявляется; manual control expectations проверяются независимо.

## Зафиксированные ограничения

Это scalar vertical slice ACC-05. Профили `std::string/vector`, custom objects/RAII/operators, templates as selected functions, range-for, exception paths, multi-file compile context и statements wrapper остаются следующим этапом. У `BUILT_WITH_ABSTRACTION` тела callees, исключения и lifetime paths явно исключены из покрытия. Native CFG/graph extraction не проверяет UB, termination, входные значения или runtime correctness. Полная матрица ТЗ и packaged clean-Windows acceptance не объявлены выполненными.

Evidence: [tests/evidence.json](tests/evidence.json), [tests/binary-evidence.json](tests/binary-evidence.json). Generated graph responses находятся в ignored `tests/artifacts`; команда воспроизводит их.

## Источники и лицензии

Официальный [LLVM SDK 23.1.3](https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.3): asset `clang+llvm-23.1.3-x86_64-pc-windows-msvc.tar.zst`, 276,320,456 bytes; published SHA256 `7e69dc07a4536b79ff24a651a2611990bf8eaab17ea560f1092707c4f31ba01d` совпала. URL/tag/digest сохранены локально в `tools/clang-sdk/manifest.json`, а скрипт содержит pinned values. Архив распаковывается официальным zstd decoder с long window; временный 4.28GB tar после проверки SDK удалён.

SDK exports static compression dependencies, но не содержит их dev libraries. [zlib 1.3.2](https://github.com/madler/zlib/releases/tag/v1.3.2) source release имеет published SHA256 `bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16`. [zstd 1.5.7](https://github.com/facebook/zstd/releases/tag/v1.5.7) source release pinned SHA256 `eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3`; это observed official-asset digest, upstream API digest отсутствовал. Они собираются локально `/MT`; все URL/hash/version сохранены в `tools/clang-sdk/dependencies.json` и bootstrap script.

Лицензии сохранены в `notices`: LLVM Apache-2.0 with LLVM exception, zlib license, zstd BSD license. API опирается на официальные [LibTooling](https://clang.llvm.org/docs/LibTooling.html), [Clang AST](https://clang.llvm.org/docs/IntroductionToTheClangAST.html) и native SDK headers/API.

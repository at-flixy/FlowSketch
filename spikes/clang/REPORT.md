# Clang spike: проверенный результат

Статус: PASS. 20/20 проверок корпуса; 14 графов из реального AST и CFG; 1 отдельный stdlib smoke; 5 проверок отказа. Это не приемка T01–T50.
Отдельно: 7/7 feedback/empty-loop проверок. Исходный счетчик 14 графов не заменен расширением корпуса.

Системный Clang не найден в PATH и проверенных стандартных LLVM/Visual Studio путях. Поиск не являлся полным сканированием диска. Загружен локальный официальный llvm-mingw UCRT x86_64, без установки в систему и без изменения PATH/registry.

## Воспроизведение

Однократно: `pwsh -NoProfile -File spikes/clang/bootstrap-toolchain.ps1` из корня проекта.
Повтор проверки: `node spikes/clang/run-spike.mjs` либо `pwsh -NoProfile -File spikes/clang/run-spike.ps1`.
Требуется Node.js (проверено на v24.11.1). Root package и npm dependencies для этого эксперимента не нужны.

Точный executable: `tools\llvm-mingw-20261006-ucrt-x86_64\bin\clang++.exe`.
Версия: `clang version 23.1.3 (https://github.com/llvm/llvm-project.git 0d261d1ca552c95a8f007e061c787ac7132fbcbc) | Target: x86_64-w64-windows-gnu | Thread model: posix | InstalledDir: tools/llvm-mingw-20261006-ucrt-x86_64/bin | Configuration file: tools/llvm-mingw-20261006-ucrt-x86_64/bin/x86_64-w64-windows-gnu.cfg`.
Release tag: `20261006`.
Архив: https://github.com/mstorsjo/llvm-mingw/releases/download/20261006/llvm-mingw-20261006-ucrt-x86_64.zip
SHA256 архива: `317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a`; совпадает с опубликованным digest GitHub asset.
SHA256 executable: `ee85bef2c733e24a26c22be3df94bd631cf9528a048fce91241c182a936737fe`.

## Реальные проверки

- Использованы `-std=c++17 -pedantic-errors -Werror=return-type -fsyntax-only`; линковка и выполнение пользовательского C++ отсутствуют.
- Ресурсные/стандартные includes задаются явно: `--no-default-config`, фиксированные target/sysroot/resource-dir, `-nostdinc -nostdinc++` и три bundled `-isystem` пути.
- Child environment содержит только SystemRoot, windir, TEMP, TMP и PATH из project/bin + System32. INCLUDE/LIB/CPATH/Visual Studio/SDK переменные не наследуются; глобальное окружение не изменено.
- iostream, vector, string, algorithm и cmath действительно разобраны вместе с использованием cin/cout, endl, vector<int>, sort, string, sqrt/pow.
- Получены отдельные выбранные FunctionDecl AST JSON и debug.DumpCFG. Критические CFG ожидания сформулированы вручную; пустые служебные CFG блоки нормализуются без удаления действий.
- Проверены for/continue, while/continue, do/continue, вложенный break, switch fallthrough/no-default/continue, &&/||, return, main implicit return0 и if/else.
- Русский комментарий до for/return проверяет UTF8 offsets. originalText для каждого несинтетического узла сверяется с точным Buffer slice. Offset и column единицы явно utf8-bytes; UI UTF16 conversion — задача будущего протокола/редактора.
- Управляющий макрос, ошибка C++, volatile, non-void fallthrough и непрозрачный вызов без complete declaration metadata не становятся готовым графом.

| Случай | Статус | Проверка | Узлы/ребра |
|---|---|---|---|
| sumOdd | BUILT_NORMAL_FLOW | PASS | 10/11 |
| forContinue | BUILT_NORMAL_FLOW | PASS | 10/11 |
| whileContinue | BUILT_NORMAL_FLOW | PASS | 9/10 |
| doContinue | BUILT_NORMAL_FLOW | PASS | 9/10 |
| nestedBreak | BUILT_NORMAL_FLOW | PASS | 14/16 |
| switchFallthrough | BUILT_NORMAL_FLOW | PASS | 9/10 |
| switchNoDefault | BUILT_NORMAL_FLOW | PASS | 7/7 |
| switchContinue | BUILT_NORMAL_FLOW | PASS | 11/12 |
| shortCircuitAnd | BUILT_NORMAL_FLOW | PASS | 7/8 |
| shortCircuitOr | BUILT_NORMAL_FLOW | PASS | 7/8 |
| earlyReturn | BUILT_NORMAL_FLOW | PASS | 6/6 |
| implicitMain | BUILT_NORMAL_FLOW | PASS | 4/3 |
| ifElse | BUILT_NORMAL_FLOW | PASS | 6/6 |
| stdlib | PARSED_ONLY | PASS | 0/0 |
| utf8Offsets | BUILT_NORMAL_FLOW | PASS | 8/8 |
| macroDenied | UNSUPPORTED | PASS | 0/0 |
| syntaxError | INPUT_ERROR | PASS | 0/0 |
| volatileDenied | UNSUPPORTED | PASS | 0/0 |
| missingReturn | INPUT_ERROR | PASS | 0/0 |
| opaqueDenied | UNSUPPORTED | PASS | 0/0 |

Feedback hints: `edge.layoutHint="back"`, forward DAG исключает только `role="back"` или явно отмеченный layoutHint. Семантический continue сохраняется. While continue является обратным; do-while continue к нижней проверке и for continue к increment остаются прямыми. For без increment и empty self-loops помечены отдельно; conditional branch Да/Нет сохраняется.

| Дополнительный feedback случай | Статус | Проверка | Узлы/ребра |
|---|---|---|---|
| emptyWhile | BUILT_NORMAL_FLOW | PASS | 3/3 |
| emptyWhileAnd | BUILT_NORMAL_FLOW | PASS | 4/5 |
| emptyForNoIncrement | BUILT_NORMAL_FLOW | PASS | 3/3 |
| forContinueNoIncrement | BUILT_NORMAL_FLOW | PASS | 4/4 |
| emptyDo | BUILT_NORMAL_FLOW | PASS | 3/3 |
| emptyIfWhile | BUILT_NORMAL_FLOW | PASS | 4/5 |
| emptyForever | BUILT_NORMAL_FLOW | PASS | 3/2 |

## API для интеграции эксперимента

`import {analyzeCpp,getToolchain} from "./spikes/clang/analyze.mjs"`.
`analyzeCpp({source,functionName,id,fileLabel,outputDirectory,skipCfg,skipGraph,verbose})` синхронно возвращает `{status,graph,ast,cfg,syntax,astProcess,cfgProcess,adapterError,...}`. Function name в этом эксперименте только простое уникальное имя.
`import {astToGraph} from "./spikes/clang/ast-to-graph.mjs"`.
`astToGraph(ast,{source,file,id,title})` принимает выбранный Clang FunctionDecl и точный UTF8 snapshot; возвращает nodes/edges с sourceRange, originalText и явными back/continue/break/true/false/case/default/return roles.
Готовый первый граф для ELK/export: `spikes/clang/sumOdd.graph.json`; оригинальные source/AST/CFG находятся в `results/sumOdd`.

## Ограничения и следующий переход

- Not a clean Windows VM; PKG-02 is NOT passed.
- CLI filtered AST JSON and debug.DumpCFG are version-specific spike formats, not final bounded native sidecar protocol.
- AST-name filter collisions/overloads require selected-function native LibTooling filtering.
- STL headers smoke proves parse availability, not admitted STL graph semantics.
- Only the experimental scalar/control subset is graph-adapted; opaque calls rejected without complete called-declaration metadata.
- No full matrix T01-T50 acceptance; no source execution, runtime correctness, UB, termination or complete exception/lifetime analysis.
- Adapter source offsets are UTF-8 bytes; Windows Job Object, VFS allowlist, hard memory budget and production cancellation are not implemented here.
- Adapter не является полной реализацией норматива v1: STL graph profiles, if-init, range-for, user templates, macros, RAII, noreturn metadata и final native sidecar еще не реализованы.
- CLI filtered AST/debug CFG формат закреплен только этим toolchain. Для Tauri prototype нужен Native LibTooling analyzer с выбором функции до serialization, стабильным versioned JSON и ограничением выходного объема. Нельзя сериализовать целый header AST и считать малые текущие файлы доказательством 16MiB предела.
- PKG-02 на чистых офлайн Windows 10/11 НЕ пройден. Текущий проход с очищенным environment — полезное подтверждение include self-containment на этом хосте, а не чистая VM/проверка установщика.

## Первичные источники

- https://github.com/mstorsjo/llvm-mingw/releases/tag/20261006
- https://clang.llvm.org/docs/IntroductionToTheClangAST.html
- https://clang.llvm.org/docs/UsersManual.html
- https://clang.llvm.org/docs/analyzer/developer-docs/DebugChecks.html

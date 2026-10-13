# Проверка переносимого header runtime

**6/6 проверок PASS** на настоящем native LibTooling analyzer с отдельно скопированным runtime. В runtime нет `bin`, `.exe`, `.dll`, `.lib` или `.a`; `bin/clang++.exe` физически отсутствует. PATH дочернего процесса содержит только Windows System32, INCLUDE/LIB/CPATH/CPLUS_INCLUDE_PATH/C_INCLUDE_PATH очищены. Сторонний compiler process не запускался, пользовательский C++ не исполнялся.

Проверки: include iostream; include cmath + opaque sqrt; совместный iostream/cmath; iostream/cmath/vector/string/algorithm include lookup; cout operators с ожидаемым UNSUPPORTED; внешний absolute include с ожидаемым INPUT_ERROR. Положительные случаи содержат настоящее Clang CFG summary. Результаты сохранены в [evidence.json](evidence.json) и отдельных JSON ответах.

Для fixed native profile достаточно копировать из `tools/llvm-mingw-20261006-ucrt-x86_64` два дерева без изменений:

```text
resources/cpp17-profile/
  include/**                    # включает include/c++/v1 и MinGW C/Windows headers
  lib/clang/23/include/**        # Clang resource headers
  notices/**
```

Native analyzer получает trusted `--toolchain-root` этого каталога. Три include lookup пути: `include/c++/v1`, `lib/clang/23/include`, `include`; resource-dir=`lib/clang/23`, sysroot=runtime root. Это те же относительные paths, которые уже зафиксированы в analyzer, поэтому source/native/root configuration не менялись.

Из исходного toolchain не нужны `bin`, Python/Busybox, target-triplet каталоги, compiler-rt libraries, libc++/unwind DLL/lib и остальная часть `lib`. Native analyzer.exe и WebView2/Tauri компоненты комплектуются отдельно; этот вывод относится к C++ parsing runtime.

Два header дерева содержат **4077 файлов, 124654972 байта**; ссылок/reparse points нет. С семью notices — 4084 файла, 124720900 байт. Это минимальный набор каталогов для существующего общего include profile. Dependency closure только конкретных iostream/cmath snippets был бы меньше, но не подтверждал бы поддержку остальных допустимых include и вариантов conditional headers; такой узкий список здесь не объявляется общим профилем.

[manifest.json](manifest.json) — точный предложенный manifest: upstream tag/version/URL/asset SHA256, fixed arguments, copy/include roots, каждый относительный file path/размер/SHA256. Все header hashes относятся к отдельно скопированному runtime. [run.mjs](run.mjs) воспроизводит копирование, inventory и native checks; `--reuse` повторно проверяет существующий runtime.

## Notices

Header файлы копируются с исходными copyright/license comments. Вместе с ними manifest сохраняет:

| Исходный файл | Внутри runtime |
|---|---|
| `LICENSE.TXT` | `notices/LLVM-libcxx-Clang-LICENSE.txt` |
| `x86_64-w64-mingw32/share/mingw32/COPYING` | `notices/mingw-w64-COPYING.txt` |
| тот же каталог / `COPYING.MinGW-w64.txt` | `notices/mingw-w64-NOTICES.txt` |
| тот же каталог / `COPYING.MinGW-w64-runtime.txt` | `notices/mingw-w64-runtime-NOTICES.txt` |
| тот же каталог / `COPYING.winpthreads.txt` | `notices/winpthreads-NOTICES.txt` |
| тот же каталог / `COPYING.winstorecompat.txt` | `notices/winstorecompat-NOTICES.txt` |
| `notices-source/COPYING.LGPLv2.1`, рядом с manifest | `notices/COPYING.LGPLv2.1` |

Последний файл дополняет пробел upstream: DirectX/DDK headers содержат LGPL-2.1-or-later notices, `COPYING.MinGW-w64.txt` ссылается на полный LGPL2.1 text, но извлечённый архив и проверенное дерево Mingw source его не содержат. Добавлен неизменённый [официальный GNU LGPL 2.1 text](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt), SHA256 `20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95`. Он указан отдельно в `additionalNotices` с URI/hash и `fromBase:'manifest-directory'`.

Полный малый upstream notice набор сохранён без удаления copyright attribution. Notices компилированного analyzer берутся дополнительно из `native/analyzer/notices` (LLVM, zlib, zstd); они относятся к native executable, а не к header copying.

Происхождение bundle: [llvm-mingw tag 20261006, LLVM23.1.3](https://github.com/mstorsjo/llvm-mingw/releases/tag/20261006). Exact Mingw revision `a3d93999ef0521681d45e445c39964a7af0f593f` подтверждён [build-mingw-w64.sh этого tag](https://raw.githubusercontent.com/mstorsjo/llvm-mingw/20261006/build-mingw-w64.sh); анализатор Clang SDK также 23.1.3.

Проверка выполнена на машине разработчика. Она подтверждает перенос относительного header profile и отсутствие compiler.exe, но не заменяет clean-Windows/offline Tauri packaging gate, который выполняется отдельно. Semantics profiles string/vector/cout и полные T01–T50 не объявлены поддержанными.

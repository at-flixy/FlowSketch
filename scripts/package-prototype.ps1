[CmdletBinding()]
param([string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
$taskProjectDirectory = Split-Path -Parent $PSScriptRoot
if (-not $ExecutablePath) { $ExecutablePath = Join-Path $taskProjectDirectory 'src-tauri/target/debug/flowsketch.exe' }
$taskExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$taskDestination = Join-Path $taskProjectDirectory 'prototype/windows-x64'
$taskRuntime = Join-Path $taskProjectDirectory 'tools/llvm-mingw-20261006-ucrt-x86_64'
$taskAnalyzer = Join-Path $taskProjectDirectory 'native/analyzer/build/bin/flowsketch-analyzer.exe'
if (-not (Test-Path -LiteralPath $taskAnalyzer)) { throw 'Build the native analyzer first.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRuntime 'include/c++/v1/iostream'))) { throw 'Bootstrap the pinned toolchain first.' }
New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
Copy-Item -LiteralPath $taskExecutable -Destination (Join-Path $taskDestination 'FlowSketch.exe') -Force
New-Item -ItemType Directory -Path (Join-Path $taskDestination 'analyzer') -Force | Out-Null
Copy-Item -LiteralPath $taskAnalyzer -Destination (Join-Path $taskDestination 'analyzer/flowsketch-analyzer.exe') -Force
$taskToolchain = Join-Path $taskDestination 'toolchain'
New-Item -ItemType Directory -Path (Join-Path $taskToolchain 'lib/clang/23') -Force | Out-Null
# Complete allowed include trees, not the SDK and not a fixture-specific dependency subset.
Copy-Item -LiteralPath (Join-Path $taskRuntime 'include') -Destination $taskToolchain -Recurse -Force
Copy-Item -LiteralPath (Join-Path $taskRuntime 'lib/clang/23/include') -Destination (Join-Path $taskToolchain 'lib/clang/23') -Recurse -Force
$taskNotices = Join-Path $taskDestination 'notices'
New-Item -ItemType Directory -Path $taskNotices -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $taskProjectDirectory 'native/analyzer/notices') -Destination $taskNotices -Recurse -Force
Copy-Item -LiteralPath (Join-Path $taskProjectDirectory 'THIRD_PARTY_NOTICES.md') -Destination $taskNotices -Force
Copy-Item -LiteralPath (Join-Path $taskProjectDirectory 'spikes/layout-export/fonts/LICENSE_LIBERATION.txt') -Destination $taskNotices -Force
Copy-Item -LiteralPath (Join-Path $taskProjectDirectory 'docs/distribution-notices') -Destination $taskNotices -Recurse -Force
foreach ($taskFontPackage in @('ibm-plex-sans','jetbrains-mono')) {
    $taskLicense = Join-Path $taskProjectDirectory ('node_modules/@fontsource/' + $taskFontPackage + '/LICENSE')
    if (Test-Path -LiteralPath $taskLicense) { Copy-Item -LiteralPath $taskLicense -Destination (Join-Path $taskNotices ($taskFontPackage + '-LICENSE.txt')) -Force }
}
$taskHeaderNotices = Join-Path $taskNotices 'headers'
New-Item -ItemType Directory -Path $taskHeaderNotices -Force | Out-Null
$taskHeaderManifestDirectory = Join-Path $taskProjectDirectory 'spikes/tauri/runtime-review'
$taskHeaderManifest = Get-Content -LiteralPath (Join-Path $taskHeaderManifestDirectory 'manifest.json') -Raw | ConvertFrom-Json
foreach ($taskNotice in $taskHeaderManifest.notices) {
    Copy-Item -LiteralPath (Join-Path $taskRuntime $taskNotice.from) -Destination (Join-Path $taskHeaderNotices ([IO.Path]::GetFileName($taskNotice.to))) -Force
}
foreach ($taskNotice in $taskHeaderManifest.additionalNotices) {
    Copy-Item -LiteralPath (Join-Path $taskHeaderManifestDirectory $taskNotice.from) -Destination (Join-Path $taskHeaderNotices ([IO.Path]::GetFileName($taskNotice.to))) -Force
}
$taskReadme = @'
FlowSketch 0.1 — первый рабочий прототип для Windows x64.

Запуск: откройте FlowSketch.exe. Сохраняйте папки analyzer, toolchain и notices рядом с ним.
Нужен установленный Microsoft Edge WebView2 Runtime. Node.js, Rust и компилятор C++ для запуска не нужны.

1. Вставьте законченную функцию C++ или откройте UTF-8 .cpp.
2. Нажмите «Найти функции», выберите функцию и «Построить схему».
3. В режиме «Оформление» выберите шаблон, цвета, размер текста или автоматическое размещение.
4. «Сохранить» создаёт .flowsketch; «Экспорт SVG» сохраняет актуальную схему.

Разбираются обычные переходы учебных скалярных функций C++17, включая if, циклы, switch, break, continue и return.
Исходный C++ не запускается. Неподдерживаемые конструкции получают диагностику.
Прототип ограничивает исходник 256 KiB / 5000 строк, граф 500 блоками и анализ 15 сек / 1 GiB.
Смена кода блокирует экспорт до повторного построения. Открытый проект восстанавливает код и стиль, затем требуется построение.
В этой версии приложения доступен экспорт SVG. PNG/PDF, вся матрица поддержки, DPI и офлайн-установщик будут доведены далее.
Проверка этой папки на чистой Windows без developer tools ещё не выполнена.

Исходники и план разработки: https://github.com/at-flixy/FlowSketch
'@
[IO.File]::WriteAllText((Join-Path $taskDestination 'Прочти меня.txt'), $taskReadme, [Text.UTF8Encoding]::new($false))
$env:FLOWSKETCH_PACKAGED_SOURCE = $taskExecutable
& node (Join-Path $PSScriptRoot 'prototype-manifest.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Prototype independent hash verification failed.' }
Write-Host ('Prototype: ' + $taskDestination)

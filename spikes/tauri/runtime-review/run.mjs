import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '../../..');
const upstream = path.join(project, 'tools/llvm-mingw-20261006-ucrt-x86_64');
const runtime = path.join(here, 'temporary-runtime');
const executable = path.join(project, 'native/analyzer/build/bin/flowsketch-analyzer.exe');
const sha = data => createHash('sha256').update(data).digest('hex');
const headerRoots = ['include', 'lib/clang/23/include'];
await fs.mkdir(runtime, { recursive: true });
if (!process.argv.includes('--reuse')) for (const relative of headerRoots) await fs.cp(path.join(upstream, relative), path.join(runtime, relative), { recursive: true, errorOnExist: false, dereference: false });
const noticeSources = [
  { from: 'LICENSE.TXT', to: 'notices/LLVM-libcxx-Clang-LICENSE.txt', component: 'libc++ and Clang resource headers; Apache-2.0 WITH LLVM-exception' },
  { from: 'x86_64-w64-mingw32/share/mingw32/COPYING', to: 'notices/mingw-w64-COPYING.txt', component: 'Mingw-w64 source/header notices' },
  { from: 'x86_64-w64-mingw32/share/mingw32/COPYING.MinGW-w64.txt', to: 'notices/mingw-w64-NOTICES.txt', component: 'Upstream source distribution notices; retain complete upstream list' },
  { from: 'x86_64-w64-mingw32/share/mingw32/COPYING.MinGW-w64-runtime.txt', to: 'notices/mingw-w64-runtime-NOTICES.txt', component: 'CRT/header portions and component notices' },
  { from: 'x86_64-w64-mingw32/share/mingw32/COPYING.winpthreads.txt', to: 'notices/winpthreads-NOTICES.txt', component: 'pthread headers included by complete header root' },
  { from: 'x86_64-w64-mingw32/share/mingw32/COPYING.winstorecompat.txt', to: 'notices/winstorecompat-NOTICES.txt', component: 'Small upstream notice kept with copied full header profile' },
];
for (const spec of noticeSources) { await fs.mkdir(path.dirname(path.join(runtime, spec.to)), { recursive: true }); await fs.copyFile(path.join(upstream, spec.from), path.join(runtime, spec.to)); }
const lgplSource = path.join(here, 'notices-source/COPYING.LGPLv2.1');
const lgplBytes = await fs.readFile(lgplSource);
assert.equal(sha(lgplBytes), '20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95');
await fs.copyFile(lgplSource, path.join(runtime, 'notices/COPYING.LGPLv2.1'));
const files = [];
async function scan(relative = '') {
  for (const item of await fs.readdir(path.join(runtime, relative), { withFileTypes: true })) {
    const entry = path.posix.join(relative.replaceAll('\\', '/'), item.name);
    assert(!item.isSymbolicLink(), `Runtime contains link: ${entry}`);
    if (item.isDirectory()) await scan(entry);
    else if (item.isFile()) { const data = await fs.readFile(path.join(runtime, entry)); files.push({ path: entry, bytes: data.length, sha256: sha(data) }); }
    else assert.fail(`Unknown filesystem entry: ${entry}`);
  }
}
await scan(); files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
assert(!files.some(file => /\.(exe|dll|lib|a)$/i.test(file.path)), 'Header runtime contains binary tool/library');
await assert.rejects(fs.stat(path.join(runtime, 'bin/clang++.exe')), { code: 'ENOENT' });
const profile = {
  manifestVersion: 1, name: 'flowsketch-cpp17-windows-header-profile', upstreamTag: '20261006', clangVersion: '23.1.3', target: 'x86_64-w64-windows-gnu',
  upstreamUrl: 'https://github.com/mstorsjo/llvm-mingw/releases/tag/20261006',
  upstreamAssetUrl: 'https://github.com/mstorsjo/llvm-mingw/releases/download/20261006/llvm-mingw-20261006-ucrt-x86_64.zip',
  upstreamAssetSha256: '317492c456aa27ee607a5919f1d2d38dcdc1112516a24d0bf4b00d078f52d17a',
  runtimeRoot: 'resources/cpp17-profile', includeRoots: ['include/c++/v1', 'lib/clang/23/include', 'include'], copyRoots: headerRoots,
  fixedArguments: ['--no-default-config', '--target=x86_64-w64-windows-gnu', '--sysroot={runtimeRoot}', '-resource-dir={runtimeRoot}/lib/clang/23', '-nostdinc', '-nostdinc++', '-isystem', '{runtimeRoot}/include/c++/v1', '-isystem', '{runtimeRoot}/lib/clang/23/include', '-isystem', '{runtimeRoot}/include', '-std=c++17', '-pedantic-errors', '-Werror=return-type', '-ferror-limit=20', '-fno-color-diagnostics', '-fno-modules', '-fno-implicit-modules', '-fno-implicit-module-maps', '-fsyntax-only'],
  compilerExecutableRequired: false, objectLibrariesRequired: false, sdkRequired: false, localSdkFallbackAllowed: false,
  notices: noticeSources,
  additionalNotices: [{ from: 'notices-source/COPYING.LGPLv2.1', fromBase: 'manifest-directory', to: 'notices/COPYING.LGPLv2.1', assetUrl: 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt', sha256: sha(lgplBytes), component: 'DirectX/DDK source headers use LGPL-2.1-or-later; complete license text missing from original extracted notices' }],
  fileCount: files.length, headerCount: files.filter(f => !f.path.startsWith('notices/')).length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files,
};
await fs.writeFile(path.join(here, 'manifest.json'), JSON.stringify(profile, null, 2));
const cases = [
  { id: 'iostream-header', source: '#include <iostream>\nint f(int n){return n+1;}\n', status: 'BUILT_NORMAL_FLOW' },
  { id: 'cmath-opaque-sqrt', source: '#include <cmath>\ndouble f(double n){return std::sqrt(n);}\n', status: 'BUILT_WITH_ABSTRACTION' },
  { id: 'iostream-cmath-combined', source: '#include <iostream>\n#include <cmath>\ndouble f(double n){return std::sqrt(n)+1.0;}\n', status: 'BUILT_WITH_ABSTRACTION' },
  { id: 'common-stl-header-lookup', source: '#include <iostream>\n#include <cmath>\n#include <vector>\n#include <string>\n#include <algorithm>\nint f(){return 1;}\n', status: 'BUILT_NORMAL_FLOW' },
  { id: 'iostream-operators-explicitly-unsupported', source: '#include <iostream>\nint f(int n){std::cout<<n;return n;}\n', status: 'UNSUPPORTED' },
  { id: 'outside-include-denied', source: '#include "C:/Windows/win.ini"\nint f(){return 1;}\n', status: 'INPUT_ERROR' },
];
const results = [];
for (const [index, test] of cases.entries()) {
  const request = { protocolVersion: 1, requestId: test.id, sourceRevision: index, sourceDigest: sha(Buffer.from(test.source, 'utf8')), contextDigest: sha('fixed-cpp17-temporary-header-runtime'), source: test.source };
  const run = spawnSync(executable, ['--toolchain-root', runtime], { input: JSON.stringify(request), encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: path.join(process.env.SystemRoot, 'System32'), INCLUDE: '', LIB: '', CPATH: '', CPLUS_INCLUDE_PATH: '', C_INCLUDE_PATH: '' }, });
  assert.equal(run.error, undefined, String(run.error)); assert.equal(run.status, 0, run.stderr);
  const response = JSON.parse(run.stdout); assert.equal(response.status, test.status, JSON.stringify(response.diagnostics));
  for (const key of ['requestId', 'sourceRevision', 'sourceDigest', 'contextDigest']) assert.equal(response[key], request[key]);
  assert.equal(response.coverage.sourceExecution, false);
  if (test.status.startsWith('BUILT_')) assert(response.cfgSummary.blocks > 0); else assert.equal(response.graph, undefined);
  const outputFile = `${test.id}.json`; await fs.writeFile(path.join(here, outputFile), JSON.stringify(response, null, 2));
  results.push({ id: test.id, passed: true, status: response.status, elapsedMs: response.elapsedMs, outputFile, diagnostics: response.diagnostics.map(d => d.code) });
  console.log(`PASS ${test.id}: ${response.status}`);
}
const evidence = { generatedAt: new Date().toISOString(), executable, executableSha256: sha(await fs.readFile(executable)), temporaryRuntime: runtime,
  runtimeHasCompiler: false, runtimeHasLibraries: false, clearedExternalIncludeEnvironment: true, nativeLibTooling: true, sourceExecution: false,
  full50CaseAcceptance: false, cleanWindowsGate: false, manifestSha256: sha(await fs.readFile(path.join(here, 'manifest.json'))),
  passed: results.length, total: cases.length, cases: results };
await fs.writeFile(path.join(here, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ passed: evidence.passed, total: evidence.total, files: profile.fileCount, headers: profile.headerCount, bytes: profile.totalBytes }));

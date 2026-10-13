import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifySumOdd } from '../../../spikes/integration/verify-sum-odd.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '../../..');
const executable = path.join(project, 'native/analyzer/build/bin/flowsketch-analyzer.exe');
const toolchainRoot = path.join(project, 'tools/llvm-mingw-20261006-ucrt-x86_64');
const artifacts = path.join(here, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const requestFor = (source, extra = {}) => ({ protocolVersion: 1, requestId: 'native-test',
  sourceRevision: 7, sourceDigest: sha(Buffer.from(source, 'utf8')), contextDigest: sha('fixed-native-cpp17'), source, ...extra });
function invoke(source, extra = {}, raw) {
  const request = requestFor(source, extra);
  const start = performance.now();
  const process = spawnSync(executable, ['--toolchain-root', toolchainRoot], {
    input: raw ?? JSON.stringify(request), encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    env: { ...globalThis.process.env, CPATH: '', CPLUS_INCLUDE_PATH: '', C_INCLUDE_PATH: '', INCLUDE: '', LIB: '' }, windowsHide: true,
  });
  assert.equal(process.error, undefined, `Process error: ${process.error}`);
  assert.equal(process.status, 0, `Process exit ${process.status}: ${process.stderr}`);
  assert(Buffer.byteLength(process.stderr) <= 256 * 1024, 'stderr exceeds bound');
  assert(Buffer.byteLength(process.stdout) <= 16 * 1024 * 1024);
  const response = JSON.parse(process.stdout);
  assert.equal(response.protocolVersion, 1);
  if (!raw) for (const key of ['requestId', 'sourceRevision', 'sourceDigest', 'contextDigest']) assert.equal(response[key], request[key], `Echo ${key}`);
  assert.equal(response.coverage.sourceExecution, false);
  assert.equal(response.coverage.full50CaseAcceptance, false);
  return { response, elapsedMs: performance.now() - start, stdoutBytes: Buffer.byteLength(process.stdout) };
}
const results = [];
async function test(id, body) {
  try { const info = await body(); results.push({ id, passed: true, ...info }); console.log(`PASS ${id}`); }
  catch (error) { results.push({ id, passed: false, error: error.stack }); console.error(`FAIL ${id}: ${error.message}`); }
}
const normalize = value => String(value).replace(/\s/g, '').replace(/;+$/, '');
function edgesMatch(graph, expected) {
  for (const [from, to, role] of expected ?? []) {
    const sources = graph.nodes.filter(node => normalize(node.label) === normalize(from)).map(node => node.id);
    const targets = graph.nodes.filter(node => normalize(node.label) === normalize(to)).map(node => node.id);
    assert(graph.edges.some(edge => sources.includes(edge.source) && targets.includes(edge.target) && (!role || edge.role === role)), `${from} -> ${to} (${role ?? '*'})`);
  }
}
function mappingAndDAG(graph, source) {
  const bytes = Buffer.from(source, 'utf8');
  const ids = new Set(graph.nodes.map(node => node.id));
  assert.equal(ids.size, graph.nodes.length);
  for (const node of graph.nodes) {
    const range = node.sourceRange;
    assert.equal(range.offsetEncoding, 'utf8-bytes'); assert.equal(range.columnEncoding, 'utf8-bytes');
    for (const point of [range.begin, range.end]) {
      const prefix = bytes.subarray(0, point.offset).toString('utf8');
      const line = prefix.split('\n').at(-1);
      assert.equal(point.line, prefix.split('\n').length);
      assert.equal(point.column, Buffer.byteLength(line) + 1);
      assert.equal(point.utf16Column, line.length + 1);
    }
    if (!range.synthetic) assert.equal(node.originalText, bytes.subarray(range.begin.offset, range.end.offset).toString('utf8'));
  }
  const incoming = new Map([...ids].map(id => [id, 0]));
  const forward = graph.edges.filter(edge => edge.role !== 'back' && edge.layoutHint !== 'back');
  for (const edge of graph.edges) assert(ids.has(edge.source) && ids.has(edge.target));
  for (const edge of forward) incoming.set(edge.target, incoming.get(edge.target) + 1);
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) { const id = queue.pop(); visited++; for (const edge of forward.filter(edge => edge.source === id)) { incoming.set(edge.target, incoming.get(edge.target) - 1); if (!incoming.get(edge.target)) queue.push(edge.target); } }
  assert.equal(visited, ids.size, 'Forward graph contains an unmarked control-flow cycle');
}
const fixtures = JSON.parse(await fs.readFile(path.join(project, 'spikes/clang/fixtures.json'), 'utf8'));
for (const fixture of fixtures) await test(fixture.id, async () => {
  const run = invoke(fixture.source);
  const response = run.response;
  const status = fixture.id === 'opaqueDenied' ? 'BUILT_WITH_ABSTRACTION' : fixture.skipGraph || fixture.expectedAdapterError ? 'UNSUPPORTED' : fixture.expectedParseError ? 'INPUT_ERROR' : 'BUILT_NORMAL_FLOW';
  assert.equal(response.status, status, JSON.stringify(response.diagnostics));
  if (status.startsWith('BUILT_')) {
    assert(response.cfgSummary.blocks > 0); assert.equal(response.graph.coverage.nativeLibTooling, true);
    edgesMatch(response.graph, fixture.expect); mappingAndDAG(response.graph, fixture.source);
    if (fixture.id === 'sumOdd') verifySumOdd(response.graph);
    if (fixture.id === 'whileContinue' || fixture.id === 'doContinue') {
      const continuation = response.graph.edges.find(edge => edge.role === 'continue');
      assert.equal(continuation.layoutHint, fixture.id === 'whileContinue' ? 'back' : undefined);
    }
    await fs.writeFile(path.join(artifacts, `${fixture.id}.json`), JSON.stringify(response, null, 2));
  } else assert.equal(response.graph, undefined, 'Negative must not expose a partial ready graph');
  return { status, stdoutBytes: run.stdoutBytes, elapsedMs: run.elapsedMs };
});
const feedbackFixtures = JSON.parse(await fs.readFile(path.join(project, 'spikes/clang/feedback-fixtures.json'), 'utf8'));
for (const fixture of feedbackFixtures) await test(`feedback-${fixture.id}`, async () => {
  const { response } = invoke(fixture.source);
  assert.equal(response.status, 'BUILT_NORMAL_FLOW', JSON.stringify(response.diagnostics));
  mappingAndDAG(response.graph, fixture.source);
  for (const [from, to, role, hint, label] of fixture.expectHints ?? []) {
    edgesMatch(response.graph, [[from, to, role]]);
    const edge = response.graph.edges.find(e => e.role === role && response.graph.nodes.some(n => n.id === e.source && normalize(n.label) === normalize(from)) && response.graph.nodes.some(n => n.id === e.target && normalize(n.label) === normalize(to)));
    assert.equal(edge.layoutHint, hint ?? undefined); assert.equal(edge.label, label);
  }
  await fs.writeFile(path.join(artifacts, `${fixture.id}.json`), JSON.stringify(response, null, 2));
  return { status: response.status };
});
await test('discover-select-second-function', async () => {
  const source = 'int one(){return 1;} int two(int n){return n+2;}';
  const found = invoke(source, { operation: 'discover' }).response;
  assert.equal(found.status, 'DISCOVERED'); assert.equal(found.graph, undefined); assert.equal(found.functions.length, 2);
  const chosen = found.functions.find(f => f.name === 'two');
  const response = invoke(source, { functionId: chosen.id }).response;
  assert.equal(response.functionId, chosen.id); assert.equal(response.graph.title, 'two');
  return { functions: found.functions.map(f => f.id) };
});
await test('utf8-utf16-same-line', async () => {
  const source = 'int unicode(){/* Привет 🌟 */ return 2;}';
  const { response } = invoke(source); assert.equal(response.status, 'BUILT_NORMAL_FLOW');
  mappingAndDAG(response.graph, source);
  const node = response.graph.nodes.find(n => n.label === 'return 2');
  assert(node.sourceRange.begin.column > node.sourceRange.begin.utf16Column);
  return { byteColumn: node.sourceRange.begin.column, utf16Column: node.sourceRange.begin.utf16Column };
});
await test('opaque-condition-call-metadata', async () => {
  const source = 'bool test(int); int f(int n){if(test(n)) return 1; return 0;}';
  const { response } = invoke(source); assert.equal(response.status, 'BUILT_WITH_ABSTRACTION');
  const call = response.graph.abstractions.find(a => a.callee === 'test'); assert.equal(call.signature, 'test(int)'); assert.equal(call.noReturn, false);
  return { status: response.status };
});
await test('direct-noreturn-terminal', async () => {
  const source = '[[noreturn]] void stop(); void f(){stop(); int unreachable=1;}';
  const { response } = invoke(source); assert.equal(response.status, 'BUILT_WITH_ABSTRACTION');
  const call = response.graph.nodes.find(n => n.label === 'stop()');
  const edge = response.graph.edges.find(e => e.source === call.id); assert.equal(edge.role, 'nonreturn');
  assert.equal(response.graph.edges.filter(e => e.source === edge.target).length, 0);
  return { status: response.status };
});
for (const fixture of [
  { id: 'custom-raii', source: 'struct X{~X(){}}; int f(){X x;return 1;}', status: 'UNSUPPORTED' },
  { id: 'overloaded-logical', source: 'struct X{}; bool operator&&(X,X); int f(X a,X b){if(a&&b)return 1;return 0;}', status: 'UNSUPPORTED' },
  { id: 'try-catch', source: 'int f(){try{return 1;}catch(...){return 2;}}', status: 'UNSUPPORTED' },
  { id: 'goto', source: 'int f(){goto next;next:return 1;}', status: 'UNSUPPORTED' },
  { id: 'global-dynamic', source: 'int init();int x=init();int f(){return x;}', status: 'UNSUPPORTED' },
  { id: 'external-include-denied', source: '#include "C:/Windows/win.ini"\nint f(){return 1;}', status: 'INPUT_ERROR' },
  { id: 'indirect-function-call', source: 'int f(int(*p)()){return p();}', status: 'UNSUPPORTED' },
  { id: 'noreturn-condition', source: '[[noreturn]] bool stop();int f(){if(stop())return 1;return 0;}', status: 'UNSUPPORTED' },
  { id: 'nesting-limit', source: 'void f(bool b){'+'if(b){'.repeat(25)+';'+ '}'.repeat(25)+'}', status: 'UNSUPPORTED' },
]) await test(fixture.id, async () => { const { response } = invoke(fixture.source); assert.equal(response.status, fixture.status, JSON.stringify(response.diagnostics)); assert.equal(response.graph, undefined); return { status: response.status, diagnostics: response.diagnostics.map(d => d.code) }; });
for (const [id, extra, source] of [
  ['protocol-version', { protocolVersion: 9 }, 'int f(){return 1;}'],
  ['digest-mismatch', { sourceDigest: '0'.repeat(64) }, 'int f(){return 1;}'],
  ['source-byte-limit', {}, ' '.repeat(256 * 1024 + 1)],
  ['source-line-limit', {}, '\n'.repeat(5001)],
]) await test(id, async () => { const { response } = invoke(source, extra); assert.equal(response.status, id.startsWith('source-') ? 'INPUT_ERROR' : 'FAILURE'); assert.equal(response.graph, undefined); return { status: response.status, diagnostics: response.diagnostics.map(d => d.code) }; });
await test('trailing-null-retains-while-feedback', async () => {
  const source = 'void f(bool a){while(a){a=false; ;}}';
  const { response } = invoke(source); assert.equal(response.status, 'BUILT_NORMAL_FLOW'); mappingAndDAG(response.graph, source);
  edgesMatch(response.graph, [['a=false', 'a', 'back']]); return { status: response.status };
});
await test('negated-short-circuit', async () => {
  const source = 'int f(bool a,bool b){if(!(a&&b))return 1;return 0;}';
  const { response } = invoke(source); assert.equal(response.status, 'BUILT_NORMAL_FLOW'); mappingAndDAG(response.graph, source);
  edgesMatch(response.graph, [['a', 'b', 'true'], ['a', 'return 1', 'false'], ['b', 'return 1', 'false'], ['b', 'return 0', 'true']]); return { status: response.status };
});
await test('explicit-main-return-is-not-labelled-zero', async () => {
  const { response } = invoke('int main(){return 7;}'); assert.equal(response.status, 'BUILT_NORMAL_FLOW');
  const ending = response.graph.nodes.find(n => n.id === response.graph.exitId); assert.equal(ending.label, 'Конец'); return { status: response.status };
});
const evidence = { generatedAt: new Date().toISOString(), executable, executableSha256: sha(await fs.readFile(executable)), toolchainRoot,
  nativeLibTooling: true, sourceExecution: false, full50CaseAcceptance: false, cleanMachinePackaging: false,
  command: 'node native/analyzer/tests/run.mjs', passed: results.filter(r => r.passed).length, total: results.length, cases: results };
await fs.writeFile(path.join(here, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(`${evidence.passed}/${evidence.total} native analyzer tests passed`);
if (evidence.passed !== evidence.total) process.exitCode = 1;

// Real WebView2 browser harness check against the optional Tauri WDIO server.
// No graph/analyzer/worker/canvas mocks. Native source analysis belongs to root E2E.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = `http://127.0.0.1:${process.env.TAURI_WEBDRIVER_PORT || 4447}`;
const output = new URL('../../spikes/tauri/diagram-browser/', import.meta.url);
await mkdir(output, { recursive: true });
async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}
const created = await call('/session', { capabilities: { alwaysMatch: { 'wdio:tauriServiceOptions': { windowLabel: 'main' } } } });
const session = created.sessionId;
const js = (script, ...args) => call(`/session/${session}/execute/sync`, { script, args });
async function wait(script) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const value = await js(script);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Browser QA wait exceeded 15 seconds: ' + script);
}
// Native WDIO async-script callbacks did not complete for the external preview
// origin. Real browser Promises run normally between independent sync commands.
async function operation(script, ...args) {
  await js('window.__diagramQaOperation=null;Promise.resolve().then(()=>{' + script + '}).then(value=>window.__diagramQaOperation={ok:true,value},error=>window.__diagramQaOperation={ok:false,message:error.message,stack:error.stack});return true;', ...args);
  const value = await wait('return window.__diagramQaOperation;');
  assert.equal(value.ok, true, JSON.stringify(value));
  return value.value;
}
const report = { runtime: 'real Tauri Windows WebView2', generatedAt: new Date().toISOString(), capabilities: created.capabilities, analyzerExecutedByHarness: false, graph: 'existing real Stage 1 Clang sumOdd JSON', results: [] };
try {
  await call(`/session/${session}/timeouts`, { script: 30000 });
  for (const [name, origin] of [['development', 'http://127.0.0.1:1420'], ['production', 'http://127.0.0.1:4240']]) {
    await call(`/session/${session}/url`, { url: origin + '/src/diagram/browser-harness.html' });
    await wait('return !!window.__diagramHarness;');
    await js('window.__diagramErrors=[];addEventListener("error",e=>window.__diagramErrors.push(e.message));addEventListener("unhandledrejection",e=>window.__diagramErrors.push(String(e.reason)));return true;');
    const built = { value: await operation('return window.__diagramHarness.build(undefined,arguments[0]);', { requestId: `browser-${name}`, modelRevision: 77, styleRevision: 9 }) };
    assert.equal(built.value.status, 'ready');
    assert.equal(built.value.nodes, 10); assert.equal(built.value.edges, 11); assert.deepEqual(built.value.diagnostics, []);
    assert.equal(built.value.modelRevision, 77); assert.equal(built.value.styleRevision, 9);
    const svg = await js('return window.__diagramHarness.svg();');
    const svgProof = await js('const d=new DOMParser().parseFromString(arguments[0],"image/svg+xml"),m=JSON.parse(d.querySelector("metadata").textContent);return {paths:d.querySelectorAll("path").length,foreignObjects:d.querySelectorAll("foreignObject").length,unicode:m.labels.some(n=>n.label==="Начало"),font:m.font,sceneDigest:m.sceneDigest};', svg);
    assert.equal(svgProof.paths, built.value.primitives); assert.equal(svgProof.foreignObjects, 0); assert.equal(svgProof.unicode, true); assert.equal(svgProof.sceneDigest, built.value.sceneDigest);
    await writeFile(new URL(`${name}.svg`, output), svg);
    const pngs = [];
    for (const scale of [1, 2]) {
      const dataUrl = await operation('return window.__diagramHarness.pngBlob(arguments[0]).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("FileReader"));reader.readAsDataURL(blob);}));', scale);
      const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(bytes.readUInt32BE(16), built.value.width * scale); assert.equal(bytes.readUInt32BE(20), built.value.height * scale);
      const filename = `${name}-${scale}x.png`; await writeFile(new URL(filename, output), bytes);
      pngs.push({ file: filename, scale, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const screenshot = await call(`/session/${session}/screenshot`); await writeFile(new URL(`${name}-canvas.png`, output), Buffer.from(screenshot, 'base64'));
    const cancellation = await operation('const a=window.__diagramHarness.build(undefined,{requestId:"old"}).then(()=>"unexpected-success",e=>e.name),b=window.__diagramHarness.build(undefined,{requestId:"new",modelRevision:78,styleRevision:10});return Promise.all([a,b]).then(([old,next])=>({old,next}));');
    assert.equal(cancellation.old, 'AbortError'); assert.equal(cancellation.next.status, 'ready'); assert.equal(cancellation.next.requestId, 'new');
    const errors = await js('return window.__diagramErrors;'); assert.deepEqual(errors, []);
    report.results.push({ name, url: origin, passed: true, snapshot: built.value, svg: svgProof, pngs, cancellation: { old: cancellation.old, newestRequestId: cancellation.next.requestId }, errors });
  }
  assert.equal(report.results[0].snapshot.sceneDigest, report.results[1].snapshot.sceneDigest);
  await writeFile(new URL('webview2-browser-evidence.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, runtime: report.runtime, modes: report.results.map(r => r.name), sceneDigest: report.results[0].snapshot.sceneDigest, exports: report.results.flatMap(r => r.pngs.map(p => p.file)), evidence: 'spikes/tauri/diagram-browser/webview2-browser-evidence.json' }));
} finally {
  // Restore the test app; root will rebuild it to verify the actual tauri origin.
  await call(`/session/${session}/url`, { url: 'http://tauri.localhost/' }).catch(() => {});
  await call(`/session/${session}`, undefined, 'DELETE').catch(() => {});
}

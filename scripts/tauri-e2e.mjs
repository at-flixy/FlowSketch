// Real Windows WebView2/Tauri integration; no analyzer, IPC, graph or layout mocks.
// Run against the optional `webdriver` build. Dialog path choice alone is automated.
import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'spikes/tauri/evidence');
await mkdir(out,{recursive:true});
const base=`http://127.0.0.1:${process.env.TAURI_WEBDRIVER_PORT||4447}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let session;
async function call(path,body,method=body===undefined?'GET':'POST') {
  const response=await fetch(base+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  const data=await response.json();if(!response.ok||(data.value?.error&&data.value?.message))throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);return data.value;
}
async function js(script,...args){return await call(`/session/${session}/execute/sync`,{script,args});}
async function invoke(command,args={}){return await call(`/session/${session}/execute/async`,{script:'const done=arguments[arguments.length-1]; window.__TAURI__.core.invoke(arguments[0],arguments[1]).then(v=>done({ok:true,value:v}),e=>done({ok:false,error:String(e)}));',args:[command,args]});}
async function click(selector){await js('const e=document.querySelector(arguments[0]); if(!e||e.disabled)throw new Error("button unavailable: "+arguments[0]);if(typeof e.click==="function")e.click();else e.dispatchEvent(new MouseEvent("click",{bubbles:true}));return true;',selector);}
async function textClick(text){await js('const e=[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===arguments[0]);if(!e||e.disabled)throw new Error("button unavailable: "+arguments[0]);e.click();return true;',text);}
async function state(){return await js('return {url:location.href,desktop:!!window.__TAURI_INTERNALS__,title:document.querySelector(".project-title")?.textContent,scene:document.querySelector(".fs-diagram")?.dataset.sceneStatus,digest:document.querySelector("[data-scene-digest]")?.dataset.sceneDigest,nodes:[...document.querySelectorAll(".fs-diagram [data-node-id]")].map(e=>({id:e.dataset.nodeId,label:e.getAttribute("aria-label"),selected:e.getAttribute("aria-pressed")})),exportEnabled:!document.querySelector(".top-actions button:nth-child(2)")?.disabled,diagnostics:[...document.querySelectorAll(".diagnostic")].map(e=>e.textContent),body:document.body.innerText,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},overflow:document.documentElement.scrollWidth>innerWidth};');}
async function waitFor(predicate,label,timeout=25000){const start=Date.now();while(Date.now()-start<timeout){const value=await state();if(predicate(value))return value;await pause(120);}throw new Error(`${label}: ${JSON.stringify(await state())}`);}
async function screenshot(name){await pause(200);const data=await call(`/session/${session}/screenshot`);await writeFile(resolve(out,name+'.png'),Buffer.from(data,'base64'));}
const steps=[];const record=(name,detail)=>{steps.push({name,passed:true,detail});console.log('PASS '+name);};
const source='// Кириллица: сумма нечётных\nint sumOdd(int n) {\n    int s = 0;\n    for (int i = 1; i <= n; ++i) {\n        if (i % 2 == 0) continue;\n        s += i;\n    }\n    return s;\n}\nint twice(int n) { return n * 2; }\n';
await writeFile(resolve(out,'input.cpp'),source,'utf8');
const report={generatedAt:new Date().toISOString(),runtime:'Tauri + Windows WebView2',mockAnalyzer:false,mockGraph:false,submittedCodeExecuted:false,dialogPathSelection:'test-only fixture directory; real native file handlers',interactiveNativeDialogAutomated:false,full50CaseAcceptance:false,cleanWindowsAcceptance:false,steps};
try{
  const created=await call('/session',{capabilities:{alwaysMatch:{'wdio:tauriServiceOptions':{windowLabel:'main'}}}});session=created.sessionId;
  assert.ok(session);report.capabilities=created.capabilities;
  await call(`/session/${session}/timeouts`,{script:30000});
  await waitFor(s=>s.desktop&&s.body.includes('Построить схему'),'real desktop');
  await js('localStorage.removeItem("flowsketch.style-library.v1");return true;');
  await call(`/session/${session}/url`,{url:'http://tauri.localhost/'});
  await waitFor(s=>s.desktop&&s.body.includes('Построить схему')&&!s.body.includes('input.cpp'),'fresh test workspace');
  // Capture JS errors and CSP violations before exercising worker/font loading.
  await js('window.__qaErrors=[];addEventListener("error",e=>window.__qaErrors.push(String(e.message)));addEventListener("unhandledrejection",e=>window.__qaErrors.push(String(e.reason)));addEventListener("securitypolicyviolation",e=>window.__qaErrors.push("CSP: "+e.violatedDirective+" "+e.blockedURI));return true;');
  record('real-desktop-origin',{...(await state()).viewport,url:(await state()).url});
  const runtime=await invoke('runtime_info');assert.ok(runtime.ok);report.nativeRuntime=runtime.value;
  assert.ok(runtime.value.clangToolchainArgument.endsWith('/toolchain'));assert.ok(!runtime.value.clangToolchainArgument.includes('/tools/llvm-mingw'));
  await textClick('Открыть .cpp');
  await waitFor(s=>s.title==='input','cpp opened');
  record('cpp-real-file-open',{sourceSha256:createHash('sha256').update(source).digest('hex')});
  await click('button[aria-label="Найти функции"]');
  await waitFor(s=>s.body.includes('sumOdd')&&!s.body.includes('Ищем функции')&&!s.body.includes('Поиск функций'),'discovery');
  for(let attempt=0;attempt<100;attempt++) { if(await js('return document.querySelector("#function-choice").options.length>=3;'))break;await pause(100); }
  const options=await js('return [...document.querySelector("#function-choice").options].map(e=>({value:e.value,label:e.textContent}));');
  const selected=options.find(e=>e.label.includes('sumOdd'));assert.ok(selected);
  await js('const e=document.querySelector("#function-choice");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));return true;',selected.value);
  record('native-function-discovery',options);
  await click('.build-footer button.primary');
  const built=await waitFor(s=>s.scene==='ready'&&s.exportEnabled,'worker font layout and actual Clang');
  assert.ok(built.nodes.some(e=>e.label.includes('continue')));assert.ok(built.nodes.some(e=>e.label.includes('return s')));
  record('cpp-to-canvas',built);await screenshot('01-code-native');
  const second=options.find(e=>e.label.includes('twice'));assert.ok(second);
  await js('const e=document.querySelector("#function-choice");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));return true;',second.value);
  await waitFor(s=>!s.exportEnabled&&s.nodes.length===0,'different function clears scene');
  await click('.build-footer button.primary');await waitFor(s=>s.exportEnabled&&s.nodes.some(n=>n.label.includes('return n * 2')),'second function built');
  await js('const e=document.querySelector("#function-choice");e.value=arguments[0];e.dispatchEvent(new Event("change",{bubbles:true}));return true;',selected.value);
  const cached=await waitFor(s=>s.exportEnabled&&s.nodes.length===built.nodes.length,'cached function gets own scene');assert.equal(cached.digest,built.digest);record('function-switch-cache-uses-own-scene',true);
  // Native IPC readback, independent of UI state. Assert continue targets increment.
  const direct=await invoke('analyze',{request:{source,functionId:selected.value,sourceRevision:99,requestId:'qa-direct-99',operation:'analyze'}});
  assert.ok(direct.ok);const graph=direct.value.graph;assert.ok(graph);
  const continuation=graph.nodes.find(e=>e.label==='continue');const increment=graph.nodes.find(e=>e.label.includes('++i'));
  assert.ok(continuation&&increment);assert.ok(graph.edges.some(e=>e.source===continuation.id&&e.target===increment.id&&e.role==='continue'));
  await writeFile(resolve(out,'native-response.json'),JSON.stringify(direct.value,null,2));record('real-job-native-protocol-semantic-oracle',{status:direct.value.status,analyzerVersion:direct.value.analyzerVersion,nodes:graph.nodes.length,edges:graph.edges.length});
  const headers=await invoke('analyze',{request:{source:'#include <cmath>\n#include <iostream>\ndouble f(double x){return std::sqrt(x);}',functionId:null,sourceRevision:100,requestId:'qa-bundled-headers',operation:'analyze'}});
  assert.ok(headers.ok);assert.equal(headers.value.status,'BUILT_WITH_ABSTRACTION');record('real-job-bundled-headers-without-compiler',{status:headers.value.status,clangToolchainArgument:report.nativeRuntime.clangToolchainArgument});
  const target=graph.nodes.find(e=>e.label.includes('s += i'));assert.ok(target);
  await click(`[data-node-id="${target.id}"]`);
  await pause(100);
  const linked=await js('return {selected:document.querySelector("[data-node-id][aria-pressed=true]")?.dataset.nodeId,highlight:document.querySelectorAll(".source-linked-selection").length};');
  assert.equal(linked.selected,target.id);assert.ok(linked.highlight>0);record('block-to-code-real-monaco',linked);
  await textClick('Экспорт SVG');await waitFor(s=>s.body.includes('SVG сохранён'),'SVG saved');
  const svg0=await readFile(resolve(out,'diagram.svg'),'utf8');await copyFile(resolve(out,'diagram.svg'),resolve(out,'diagram-before-style.svg'));
  const metadata=svg=>JSON.parse(svg.match(/<metadata>(.*?)<\/metadata>/s)[1].replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
  const before=metadata(svg0);assert.equal(before.labels.length,graph.nodes.length);assert.equal(before.edges.length,graph.edges.length);record('actual-SVG-export',{bytes:Buffer.byteLength(svg0),graphDigest:before.graphDigest,sceneDigest:before.sceneDigest});
  await click('[data-mode="formatting"]');await textClick('Шаблоны');
  await waitFor(s=>s.body.includes('Шаблоны оформления')&&!s.body.includes('Предпросмотр…'),'gallery');await screenshot('03-gallery-native');
  await js('const e=[...document.querySelectorAll(".template-card")].find(e=>e.textContent.includes("Монохром"));if(!e)throw new Error("monochrome missing");e.click();return true;');
  await waitFor(s=>!s.body.includes('Предпросмотр…'),'template preview');await textClick('Применить шаблон');
  await waitFor(s=>s.exportEnabled&&s.digest!==built.digest&&!s.body.includes('Шаблоны оформления'),'template applied');
  await click('.properties-tabs button:last-child');
  const beforeFont=(await state()).digest;
  await js('const e=document.querySelector("#font-size");e.value="18";e.dispatchEvent(new Event("change",{bubbles:true}));return true;');
  await waitFor(s=>s.exportEnabled&&s.digest!==beforeFont,'font remeasure');await screenshot('02-formatting-native');
  await textClick('Экспорт SVG');await waitFor(s=>s.body.includes('SVG сохранён'),'styled SVG saved');await pause(200);
  const after=metadata(await readFile(resolve(out,'diagram.svg'),'utf8'));assert.equal(after.graphDigest,before.graphDigest);assert.deepEqual(after.edges,before.edges);assert.deepEqual(after.labels,before.labels);assert.notEqual(after.styleDigest,before.styleDigest);record('style-preserves-graph-remeasures-scene',{graphDigest:after.graphDigest,styleDigest:after.styleDigest});
  await textClick('Сохранить');await waitFor(s=>s.body.includes('Проект сохранён'),'project saved');
  const project=JSON.parse(await readFile(resolve(out,'project.flowsketch'),'utf8'));assert.equal(project.source,source);assert.equal(project.style.fontSize,18);assert.equal(project.style.templateId,'monochrome');assert.equal(project.graph,undefined);record('project-real-save-readback',{schemaVersion:project.schemaVersion,style:project.style,sourceMatches:true});
  await textClick('Сохранить');await pause(400);const backup=JSON.parse(await readFile(resolve(out,'project.flowsketch.bak'),'utf8'));assert.equal(backup.source,source);record('project-backup-real-file',true);
  await click('[aria-label="Открыть проект"]');
  await waitFor(s=>s.body.includes('Проект открыт'),'project restored');const restored=await state();assert.equal(restored.exportEnabled,false);assert.equal(restored.nodes.length,0);record('reopen-restores-code-style-requires-rebuild',true);
  await click('.build-footer button.primary');await waitFor(s=>s.scene==='ready'&&s.exportEnabled,'rebuilt after reopen');
  // A genuine edit delivered to Monaco must stale the published scene immediately.
  const editMode=await js('const e=document.querySelector(".monaco-editor [role=textbox]");if(e?.editContext){e.focus();const context=e.editContext;const start=context.selectionStart,end=context.selectionEnd;context.updateText(start,end," ");context.updateSelection(start+1,start+1);context.dispatchEvent(new TextUpdateEvent("textupdate",{updateRangeStart:start,updateRangeEnd:end,text:" ",selectionStart:start+1,selectionEnd:start+1}));return "native EditContext textupdate";}return "textarea";');
  if(editMode==='textarea') {
    const field=await call(`/session/${session}/element`,{using:'css selector',value:'.monaco-editor textarea.inputarea'});const fieldId=field['element-6066-11e4-a52e-4f735466cecf'];
    await call(`/session/${session}/element/${fieldId}/value`,{text:' '});
  }
  const stale=await waitFor(s=>!s.exportEnabled&&s.body.includes('Код изменён'),'stale revision');record('real-editor-edit-disables-stale-export',{...stale,editMode});
  await screenshot('04-stale-native');
  await writeFile(resolve(out,'input.cpp'),'int broken( { return 0; }','utf8');
  await textClick('Открыть .cpp');
  await waitFor(s=>s.body.includes('Сохранить изменения?'),'unsaved guard');await textClick('Не сохранять');await waitFor(s=>s.nodes.length===0,'bad cpp opened');
  await click('.build-footer button.primary');const rejected=await waitFor(s=>s.diagnostics.length>0&&!s.body.includes('Разбираем код'),'invalid syntax');assert.equal(rejected.exportEnabled,false);record('invalid-code-explicit-diagnostic-no-export',rejected.diagnostics);await screenshot('05-error-native');
  // Corrupt project never replaces the current editor contents.
  await writeFile(resolve(out,'project.flowsketch'),'{"schemaVersion":999}','utf8');
  const corrupt=await invoke('open_project');assert.equal(corrupt.ok,false);record('corrupt-project-native-rejection',corrupt.error);
  await writeFile(resolve(out,'project.flowsketch'),JSON.stringify(project,null,2),'utf8');
  await writeFile(resolve(out,'input.cpp'),source,'utf8');
  report.jsErrors=await js('return window.__qaErrors;');assert.deepEqual(report.jsErrors,[]);
  report.passed=steps.length;report.success=true;
}catch(error){report.success=false;report.error=error.stack;report.state=session?await state().catch(()=>null):null;report.jsErrors=session?await js('return window.__qaErrors||[];').catch(()=>null):null;throw error;}
finally{await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));if(session)await call(`/session/${session}`,undefined,'DELETE').catch(()=>{});}

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import assert from 'node:assert/strict';
import {analyzeCpp,getToolchain} from '../clang/analyze.mjs';
import {layoutGraph,exportScene,hash} from '../layout-export/index.mjs';
import {verifySumOdd} from './verify-sum-odd.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.join(here,'out');
const project=path.resolve(here,'../..');
fs.mkdirSync(out,{recursive:true});
const base=fs.readFileSync(path.join(here,'sum-odd.cpp'),'utf8');
const sources=[
  {id:'sumOdd',source:base,title:'Сумма нечётных чисел'},
  {id:'sumOddUtf8',source:'// Русский комментарий до функции: Ёж и схема\n'+base.replace('if (i % 2 == 0)','/* Проверка чётности */ if (i % 2 == 0)'),title:'Сумма нечётных с русским комментарием'}
];
const python=process.env.FLOWSKETCH_PYTHON||(process.platform==='win32'?'python':'python3');
const poppler=process.env.FLOWSKETCH_PDFTOPPM||'pdftoppm';
const results=[];
for(const fixture of sources){
  const start=performance.now();
  const analysis=analyzeCpp({source:fixture.source,functionName:'sumOdd',id:fixture.id,fileLabel:fixture.id+'.cpp',outputDirectory:path.join(out,fixture.id+'-compiler')});
  assert(['BUILT_NORMAL_FLOW','BUILT_WITH_ABSTRACTION'].includes(analysis.status),JSON.stringify({status:analysis.status,error:analysis.adapterError,diagnostics:analysis.syntax?.stderr}));
  assert(analysis.cfg.includes('(ENTRY)')&&analysis.cfg.includes('(EXIT)'), 'Real CFG missing');
  const oracle=verifySumOdd(analysis.graph);
  const bytes=Buffer.from(fixture.source,'utf8');
  const mapped=analysis.graph.nodes.filter(n=>n.originalText!==null);
  for(const node of mapped){
    const r=node.sourceRange;
    assert.equal(bytes.subarray(r.begin.offset,r.end.offset).toString('utf8'),node.originalText,'Original text does not match byte range');
    assert.equal(bytes.subarray(0,r.begin.offset).toString('utf8').split('\n').length,r.begin.line,'User line mapping incorrect');
  }
  analysis.graph.title=fixture.title;
  const before=hash(analysis.graph);
  const scene=await layoutGraph(analysis.graph,{timeoutMs:5000});
  assert.equal(scene.status,'ready',JSON.stringify(scene.diagnostics));
  assert.equal(before,hash(analysis.graph),'Layout changed semantic model');
  assert.equal(scene.nodes.length,analysis.graph.nodes.length);
  assert.equal(scene.edges.length,analysis.graph.edges.length);
  const sceneEdges=new Map(scene.edges.map(e=>[e.id,e]));
  for(const original of analysis.graph.edges){
    const rendered=sceneEdges.get(original.id);
    assert(rendered,'Missing edge ID');
    assert.deepEqual(Object.fromEntries(Object.keys(original).map(k=>[k,rendered[k]])),original,'Layout changed a transition or its semantic metadata');
  }
  for(const original of analysis.graph.nodes){
    const rendered=scene.nodes.find(n=>n.id===original.id);
    assert.deepEqual(rendered.sourceRange,original.sourceRange,'Lost source mapping');
    assert.equal(rendered.originalText,original.originalText,'Changed original source text');
  }
  const exported=await exportScene(scene,path.join(out,fixture.id),{pngScale:1});
  const independentRender=JSON.parse(execFileSync(python,[path.join(project,'spikes/layout-export/verify_exports.py'),path.join(out,fixture.id),poppler],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024,windowsHide:true}));
  const files=Object.fromEntries(Object.entries(exported.paths).map(([kind,file])=>{const buffer=fs.readFileSync(file);return [kind,{path:path.relative(project,file),bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')}];}));
  results.push({id:fixture.id,status:'passed',sourceDigest:analysis.sourceSha256,oracle,sourceMappingNodesChecked:mapped.length,astBytes:Buffer.byteLength(analysis.astProcess.stdout),cfgBytes:Buffer.byteLength(analysis.cfg),sceneBounds:[scene.width,scene.height],sceneDigest:scene.sceneDigest,inputGraphUnchanged:true,semanticEdgesPreserved:true,layoutDiagnostics:scene.diagnostics,files,independentRender,timingsMs:{syntax:analysis.syntax.elapsedMs,ast:analysis.astProcess.elapsedMs,cfg:analysis.cfgProcess.elapsedMs,layout:scene.timings.totalMs,png:exported.png.ms,pdf:exported.pdfMs,total:Math.round(performance.now()-start)}});
  console.log(fixture.id+': Clang AST/CFG → graph → ELK → SVG/PDF/PNG passed');
}
const toolchain=getToolchain();
const report={schemaVersion:1,createdAt:new Date().toISOString(),toolchain:{release:toolchain.releaseTag,source:toolchain.assetUrl,sha256:toolchain.assetSha256},scope:'Two independent sumOdd integration checks using real Clang AST/CFG. No execution/linking of submitted C++. Not full C++17 or production release acceptance.',results,notVerified:['Native LibTooling protocol','Full 50-case semantic matrix and STL diagram abstraction profiles','Tauri application and Windows installation','Clean VM without dev tools','Full NFR p95 performance','A4/A3 PDF pagination and manual diagram editing']};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(project,'docs/integration-stage1.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:results.length,sourceExecuted:false,productionAccepted:false,report:path.join(project,'docs/integration-stage1.json')}));

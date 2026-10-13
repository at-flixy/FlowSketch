import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {fixtures} from './fixtures.mjs';
import {layoutGraph,exportScene,sceneSVG,fontInfo,hash} from './index.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)), evidence=path.join(here,'evidence');
const python=process.env.FLOWSKETCH_PYTHON||(process.platform==='win32'?'python':'python3');
const poppler=process.env.FLOWSKETCH_PDFTOPPM||'pdftoppm';
fs.mkdirSync(evidence,{recursive:true});
const report={schemaVersion:1,createdAt:new Date().toISOString(),scope:'Hand-authored graph layout/export spike, not C++ analyzer or Tauri packaging validation',environment:{node:process.version,platform:os.platform(),osRelease:os.release(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalCpuCount:os.cpus().length,ramGiB:Math.round(os.totalmem()/2**30*100)/100},font:fontInfo,dependencies:JSON.parse(fs.readFileSync(path.join(here,'../../package.json'),'utf8')).dependencies,cases:[],limits:{pngSide:16384,pngPixels:64000000,layoutTimeoutMs:5000},notVerified:['A4/A3 print pagination and 9pt minimum','React Flow interactive rendering and performance','Tauri/Rust packaging','arbitrary CFGs, manual locked positions, font styles and every crossing','reference-machine NFR targets or 20-run p95']};
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
if(only&&fs.existsSync(path.join(evidence,'report.json')))report.cases=JSON.parse(fs.readFileSync(path.join(evidence,'report.json'),'utf8')).cases.filter(c=>c.id!==only);
for(const graph of fixtures.filter(g=>!only||g.id===only)){
  const immutableBefore=hash(graph),scene=await layoutGraph(graph),repeat=await layoutGraph(graph);
  const record={id:graph.id,expectedNodes:graph.nodes.length,expectedEdges:graph.edges.length,actualNodes:scene.nodes.length,actualEdges:scene.edges.length,status:scene.status,diagnostics:scene.diagnostics,sceneDigest:scene.sceneDigest,deterministicRepeat:scene.sceneDigest===repeat.sceneDigest,inputUnchanged:immutableBefore===hash(graph),timings:scene.timings,repeatTiming:repeat.timings,bounds:[scene.width,scene.height],russianTextPresent:scene.nodes.some(n=>/[А-Яа-яЁё]/u.test(n.label))};
  if(!record.deterministicRepeat||!record.inputUnchanged)throw new Error(`State integrity/determinism failed: ${graph.id}`);
  const prefix=path.join(evidence,graph.id);
  if(scene.status==='ready'){
    try{record.export=await exportScene(scene,prefix);}
    catch(error){
      if(error.code!=='PNG_SIZE_LIMIT')throw error;
      record.exportBlock={code:error.code,message:error.message,notPassed:'PNG 1x full-scene raster export'};
      record.export=await exportScene(scene,prefix,{formats:['svg','pdf']});
      report.cases.push(record);fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
      console.log(`${graph.id}: geometry ready; PNG explicitly rejected ${error.message}; SVG/PDF exported`);continue;
    }
    const svg=fs.readFileSync(prefix+'.svg','utf8');
    const metadata=svg.match(/<metadata>(.*?)<\/metadata>/s)?.[1]?.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
    const decoded=JSON.parse(metadata);
    if(decoded.labels.map(x=>x.text).join('\n')!==scene.nodes.map(x=>x.label).join('\n'))throw new Error('SVG Unicode metadata mismatch');
    record.readback={svgUnicodeLabelsEqual:true,svgNoForeignObject:!svg.includes('<foreignObject'),svgNoExternalResources:!/(?:href|font-family)=/.test(svg),jsonSceneDigestEqual:JSON.parse(fs.readFileSync(prefix+'.scene.json','utf8')).sceneDigest===scene.sceneDigest,pngSignatureCorrect:fs.readFileSync(prefix+'.png').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))};
    record.independentRender=JSON.parse(execFileSync(python,[path.join(here,'verify_exports.py'),prefix,poppler],{encoding:'utf8',timeout:90000,maxBuffer:1024*1024}));
  } else fs.writeFileSync(prefix+'.diagnostic.svg',sceneSVG(scene,{diagnostic:true}));
  report.cases.push(record);
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(`${graph.id}: ${scene.status}, ${scene.nodes.length} nodes / ${scene.edges.length} edges, ${Math.round(scene.timings.totalMs)} ms, ${scene.diagnostics.length} violations`);
}
report.summary={ready:report.cases.filter(c=>c.status==='ready').length,rejected:report.cases.filter(c=>c.status!=='ready').length,completeExports:report.cases.filter(c=>c.export?.paths.png).length,explicitRasterRejections:report.cases.filter(c=>c.exportBlock).length,allDeterministic:report.cases.every(c=>c.deterministicRepeat),allInputsUnchanged:report.cases.every(c=>c.inputUnchanged)};
fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary));
if(report.summary.rejected)process.exitCode=2;

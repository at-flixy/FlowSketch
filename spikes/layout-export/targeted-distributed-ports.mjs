import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {workload} from './fixtures.mjs';
import {layoutGraph,exportScene} from './index.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),graph=workload(200);
const scene=await layoutGraph(graph,{portMode:'distributed'}),second=await layoutGraph(graph,{portMode:'distributed'});
const report={experiment:'Only 200-node high-fanout workload; distribute distinct fixed ports along safe rectangle/capsule top/bottom sides instead of sharing one point. Not promoted to default or general CFG support.',bounds:[scene.width,scene.height],timing:scene.timings,sceneDigest:scene.sceneDigest,deterministicRepeat:scene.sceneDigest===second.sceneDigest,status:scene.status,diagnostics:scene.diagnostics};
if(scene.status==='ready'){
  try{
    const prefix=path.join(here,'evidence','workload-200-distributed');report.export=await exportScene(scene,prefix);
    report.independentRender=JSON.parse(execFileSync(process.env.FLOWSKETCH_PYTHON||(process.platform==='win32'?'python':'python3'),[path.join(here,'verify_exports.py'),prefix,process.env.FLOWSKETCH_PDFTOPPM||'pdftoppm'],{encoding:'utf8',timeout:90000}));
  }catch(error){report.exportBlock={code:error.code||'EXPORT_FAILED',message:error.message};}
}
fs.writeFileSync(path.join(here,'evidence','distributed-ports-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));

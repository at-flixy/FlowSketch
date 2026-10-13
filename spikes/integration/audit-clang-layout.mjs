import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {layoutGraph,hash,sceneSVG} from '../layout-export/index.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,'../..');
const evidence=JSON.parse(fs.readFileSync(path.join(project,'spikes/clang/evidence.json'),'utf8'));
const originalFixtures=evidence.cases.filter(c=>c.passed && c.nodes>0);
assert.equal(originalFixtures.length,14,'Expected the original supported Clang spike corpus');
const fixtures=[...originalFixtures,...(evidence.feedbackCases??[]).filter(c=>c.passed&&c.nodes>0)];
assert.equal(new Set(fixtures.map(c=>c.id)).size,fixtures.length,'Duplicate audit fixture IDs');
const out=path.join(here,'out','clang-layout');
fs.mkdirSync(out,{recursive:true});

function distanceToPolygon(p,poly){
  return Math.min(...poly.map((a,i)=>{
    const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
    const q=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p.x-a[0]-q*dx,p.y-a[1]-q*dy);
  }));
}
function feedback(e){return e.role==='back'||e.layoutHint==='back';}
const results=[];
for(const fixture of fixtures){
  const graphPath=path.join(project,'spikes/clang',fixture.artifacts,'graph.json');
  const graph=JSON.parse(fs.readFileSync(graphPath,'utf8'));
  const before=hash(graph);
  try{
    const scene=await layoutGraph(graph,{timeoutMs:5000});
    assert.equal(before,hash(graph),'Layout modified the semantic graph');
    assert.equal(scene.status,'ready',JSON.stringify(scene.diagnostics));
    assert.equal(scene.nodes.length,graph.nodes.length,'Lost a semantic node');
    const sceneEdges=new Map(scene.edges.map(e=>[e.id,e]));
    assert.equal(scene.edges.length,graph.edges.length,'Lost a transition');
    for(const original of graph.edges){
      const rendered=sceneEdges.get(original.id);
      assert(rendered,'Missing edge ID');
      assert.deepEqual(Object.fromEntries(Object.keys(original).map(k=>[k,rendered[k]])),original,'Transition or semantic metadata changed');
    }
    const byId=new Map(scene.nodes.map(n=>[n.id,n]));
    for(const original of graph.nodes){
      const rendered=byId.get(original.id);
      assert.deepEqual(rendered.sourceRange,original.sourceRange,'Lost source mapping');
      assert.equal(rendered.originalText,original.originalText,'Changed original source text');
    }
    let endpointFailures=0,forwardUpward=0;
    for(const e of scene.edges){
      const source=byId.get(e.source),target=byId.get(e.target);
      if(distanceToPolygon(e.points[0],source.polygon)>.05||distanceToPolygon(e.points.at(-1),target.polygon)>.05)endpointFailures++;
      if(!feedback(e)&&target.y+target.height/2<source.y+source.height/2-.01)forwardUpward++;
    }
    assert.equal(endpointFailures,0,'Port is detached from the actual shape');
    assert.equal(forwardUpward,0,'A forward transition points upwards');
    const entry=byId.get(graph.entryId);
    assert(entry,'Missing entry');
    const reachable=scene.nodes.filter(n=>n.reachable!==false);
    assert(entry.y<=Math.min(...reachable.map(n=>n.y))+.01,'Entry is below a reachable action');
    fs.writeFileSync(path.join(out,fixture.id+'.scene.json'),JSON.stringify(scene,null,2));
    fs.writeFileSync(path.join(out,fixture.id+'.svg'),sceneSVG(scene));
    results.push({id:fixture.id,status:'passed',nodes:graph.nodes.length,edges:graph.edges.length,sceneBounds:[scene.width,scene.height],sceneDigest:scene.sceneDigest,graphFile:path.relative(project,graphPath),inputGraphUnchanged:true,semanticTransitionsPreserved:true,feedbackEdges:graph.edges.filter(feedback).length,endpointFailures,forwardUpward,entryTopmost:true,diagnostics:scene.diagnostics,layoutMs:scene.timings.totalMs});
    console.log(fixture.id+': real Clang graph → validated layout passed');
  }catch(error){
    results.push({id:fixture.id,status:'failed',message:error.message,code:error.code??null,graphFile:path.relative(project,graphPath)});
    console.error(fixture.id+': '+error.message);
  }
}
const report={schemaVersion:1,createdAt:new Date().toISOString(),scope:'All supported AST/CFG spike graphs plus added feedback regressions through the actual layout module. Existing Clang artifacts reused; no compilation or source execution in this check. This is not full C++ or production UI acceptance.',feedbackContract:'role=back or layoutHint=back; semantic roles and edge labels remain unchanged',summary:{originalGraphCases:originalFixtures.length,feedbackGraphCases:fixtures.length-originalFixtures.length,cases:results.length,passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length},results};
fs.writeFileSync(path.join(project,'docs/clang-layout-stage1.json'),JSON.stringify(report,null,2));
if(report.summary.failed)process.exitCode=1;
console.log(JSON.stringify(report.summary));

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),dir=path.join(here,'evidence');
function distanceToPolygon(p,poly){
  return Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],q=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a[0]-q*dx,p.y-a[1]-q*dy);}));
}
const records=[];
for(const filename of fs.readdirSync(dir).filter(f=>f.endsWith('.scene.json'))){
  const scene=JSON.parse(fs.readFileSync(path.join(dir,filename),'utf8')),byId=new Map(scene.nodes.map(n=>[n.id,n]));
  let endpointFailures=0,forwardUpward=0,properCrossings=0;
  for(const e of scene.edges){
    const source=byId.get(e.source),target=byId.get(e.target);
    if(distanceToPolygon(e.points[0],source.polygon)>.05||distanceToPolygon(e.points.at(-1),target.polygon)>.05)endpointFailures++;
    if(e.role!=='back'&&e.layoutHint!=='back'&&target.y+target.height/2<source.y+source.height/2-.01)forwardUpward++;
  }
  for(let i=0;i<scene.edges.length;i++)for(let j=i+1;j<scene.edges.length;j++){
    const x=scene.edges[i],y=scene.edges[j];
    if(x.source===y.source||x.target===y.target)continue; // Shared buses at a real fan-out/merge are intentional.
    for(let a=1;a<x.points.length;a++)for(let b=1;b<y.points.length;b++){
      let h0=x.points[a-1],h1=x.points[a],v0=y.points[b-1],v1=y.points[b];
      if(Math.abs(h0.x-h1.x)<.01){[h0,v0]=[v0,h0];[h1,v1]=[v1,h1];}
      if(Math.abs(h0.y-h1.y)>.01||Math.abs(v0.x-v1.x)>.01)continue;
      if(v0.x>Math.min(h0.x,h1.x)+.01&&v0.x<Math.max(h0.x,h1.x)-.01&&h0.y>Math.min(v0.y,v1.y)+.01&&h0.y<Math.max(v0.y,v1.y)-.01)properCrossings++;
    }
  }
  const entries=scene.nodes.filter(n=>!scene.edges.some(e=>e.target===n.id));
  const r={id:scene.id,sceneDigest:scene.sceneDigest,endpointFailures,forwardEdgesUpward:forwardUpward,properUnrelatedCrossings:properCrossings,entryTopmost:entries.every(n=>n.y<=Math.min(...scene.nodes.map(v=>v.y))+.01),glyphOutlineCount:scene.primitives.filter(p=>p.role==='glyph').length};
  records.push(r);
}
const report={scope:'Independent observations of written scenes; proper crossing count does not yet validate shared partial-path topology or draw bridges',createdAt:new Date().toISOString(),records};
fs.writeFileSync(path.join(dir,'geometry-observations.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(records.some(r=>r.endpointFailures||r.forwardEdgesUpward))process.exitCode=1;

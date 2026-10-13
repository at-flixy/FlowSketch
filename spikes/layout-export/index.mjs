import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { openSync } from 'fontkit';
import { Resvg } from '@resvg/resvg-js';
import PDFDocument from 'pdfkit';

const here=path.dirname(fileURLToPath(import.meta.url));
export const fontPath=path.join(here,'fonts','LiberationSans-Regular.ttf');
const font=openSync(fontPath);
export const fontInfo={family:font.familyName,postscriptName:font.postscriptName,sha256:hash(fs.readFileSync(fontPath)),unitsPerEm:font.unitsPerEm};
const fontSize=14, lineHeight=19, padding=12, EPS=.01;
const isFeedback=e=>e.role==='back'||e.layoutHint==='back';
export function hash(value){return createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');}
export class LayoutError extends Error { constructor(code,message){super(message);this.code=code;} }
const num=v=>Math.round(v*1000)/1000;
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const bbox=(x,y,width,height)=>({x,y,width,height});
const corners=r=>[[r.x,r.y],[r.x+r.width,r.y],[r.x+r.width,r.y+r.height],[r.x,r.y+r.height]];
const overlaps=(a,b,gap=0)=>a.x < b.x+b.width+gap-EPS && a.x+a.width+gap>b.x+EPS && a.y<b.y+b.height+gap-EPS && a.y+a.height+gap>b.y+EPS;
const rectPath=r=>`M${r.x} ${r.y}H${r.x+r.width}V${r.y+r.height}H${r.x}Z`;
const polygonPath=points=>points.map((p,i)=>`${i?'L':'M'}${num(p[0])} ${num(p[1])}`).join(' ')+'Z';

export function measure(text,size=fontSize) {
  for(const ch of text) if(ch!=='\n' && !font.hasGlyphForCodePoint(ch.codePointAt(0))) throw new LayoutError('FONT_GLYPH_MISSING',`Нет символа ${ch} в поставляемом шрифте`);
  const run=font.layout(text);
  return {run,width:run.positions.reduce((s,p)=>s+p.xAdvance,0)*size/font.unitsPerEm};
}
export function wrapText(text,maxWidth=200,size=fontSize) {
  const lines=[];
  // Visual whitespace normalization; original label/source stays in the graph
  // and Unicode metadata. Tabs are indentation, not missing font glyphs.
  for(const paragraph of String(text).replaceAll('\r\n','\n').replaceAll('\r','\n').replaceAll('\t','    ').split('\n')) {
    let current='';
    for(const token of paragraph.match(/\S+\s*/gu)||['']) {
      const trimmed=token.trimEnd();
      if(measure(current+trimmed,size).width<=maxWidth) {current+=token;continue;}
      if(current.trim()) {lines.push(current.trimEnd());current='';}
      if(measure(trimmed,size).width<=maxWidth) {current=token;continue;}
      // Break only an overlong unspaced token; ordinary prose uses word breaks.
      for(const ch of trimmed) {
        if(current && measure(current+ch,size).width>maxWidth) {lines.push(current);current='';}
        current+=ch;
      }
      current+=' ';
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

function sizedNode(node) {
  const kinds=new Set(['terminator','process','decision','io','call','connector']);
  if(!kinds.has(node.kind)) throw new LayoutError('NODE_KIND_UNSUPPORTED',node.kind);
  const lines=wrapText(node.label,node.kind==='decision'?190:220);
  const textWidth=Math.max(1,...lines.map(line=>measure(line).width));
  const textHeight=lines.length*lineHeight;
  let width=Math.max(160,textWidth+padding*2),height=Math.max(48,textHeight+padding*2);
  if(node.kind==='decision'){width=Math.max(180,2*(textWidth+padding*2));height=Math.max(100,2*(textHeight+padding*2));}
  if(node.kind==='io')width+=48;
  if(node.kind==='connector'){width=Math.max(width,height);height=width;}
  return {...node,lines,textWidth,textHeight,width:num(width),height:num(height)};
}

function shapePolygon(n) {
  const {x,y,width:w,height:h}=n;
  if(n.kind==='decision')return [[x+w/2,y],[x+w,y+h/2],[x+w/2,y+h],[x,y+h/2]];
  if(n.kind==='io')return [[x+24,y],[x+w,y],[x+w-24,y+h],[x,y+h]];
  if(n.kind==='terminator'||n.kind==='connector') {
    const r=n.kind==='connector'?w/2:h/2, centerLeft=x+r,centerRight=x+w-r;
    const points=[];
    for(let i=0;i<=16;i++){const a=-Math.PI/2+i*Math.PI/16;points.push([centerRight+r*Math.cos(a),y+h/2+r*Math.sin(a)]);}
    for(let i=0;i<=16;i++){const a=Math.PI/2+i*Math.PI/16;points.push([centerLeft+r*Math.cos(a),y+h/2+r*Math.sin(a)]);}
    return points;
  }
  return corners(n);
}

function pointIn(p,poly) {
  // Convex polygons, including sampled capsule boundaries.
  let sign=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],v=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    if(Math.abs(v)<EPS)continue;
    if(sign && Math.sign(v)!==sign)return false;
    sign=Math.sign(v);
  }
  return true;
}
function segmentRect(a,b,r) {
  if(Math.abs(a.x-b.x)<EPS)return a.x>r.x-EPS && a.x<r.x+r.width+EPS && Math.max(a.y,b.y)>r.y+EPS && Math.min(a.y,b.y)<r.y+r.height-EPS;
  if(Math.abs(a.y-b.y)<EPS)return a.y>r.y-EPS && a.y<r.y+r.height+EPS && Math.max(a.x,b.x)>r.x+EPS && Math.min(a.x,b.x)<r.x+r.width-EPS;
  return true;
}
function segmentPolygon(a,b,poly){
  // Route touching an unrelated shape is considered a collision too.
  if(pointIn([a.x,a.y],poly)||pointIn([b.x,b.y],poly))return true;
  for(let i=0;i<poly.length;i++){
    const c=poly[i],d=poly[(i+1)%poly.length];
    const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    const aa=[a.x,a.y],bb=[b.x,b.y],u=cross(aa,bb,c),v=cross(aa,bb,d),w=cross(c,d,aa),z=cross(c,d,bb);
    if(u*v<=0 && w*z<=0 && Math.max(Math.min(aa[0],bb[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(aa[0],bb[0]),Math.max(c[0],d[0]))+EPS && Math.max(Math.min(aa[1],bb[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(aa[1],bb[1]),Math.max(c[1],d[1]))+EPS)return true;
  }
  return false;
}

function glyphPrimitives(text,cx,cy,size=fontSize) {
  const {run,width}=measure(text,size),s=size/font.unitsPerEm;
  const baseline=cy+(font.ascent+font.descent)*s/2;
  let pen=cx-width/2;
  const primitives=[],ink=[];
  run.glyphs.forEach((g,i)=>{
    const p=run.positions[i],x=pen+p.xOffset*s,y=baseline-p.yOffset*s;
    if(g.path.commands.length) {
      primitives.push({d:g.path.toSVG(),transform:[s,0,0,-s,num(x),num(y)],fill:'#172033',role:'glyph'});
      ink.push(bbox(x+g.bbox.minX*s,y-g.bbox.maxY*s,(g.bbox.maxX-g.bbox.minX)*s,(g.bbox.maxY-g.bbox.minY)*s));
    }
    pen+=p.xAdvance*s;
  });
  return {primitives,ink};
}

function portSide(edge,source,index) {
  if(isFeedback(edge))return 'WEST';
  if(!source)return 'NORTH';
  if(edge.role==='false')return 'EAST';
  if(edge.role==='default')return 'WEST';
  if(edge.role==='case')return index%2?'EAST':'SOUTH';
  return 'SOUTH';
}
function forwardOrder(nodes,edges){
  // Diagram roles are authoritative. A known feedback edge is ignored only
  // for choosing node model order, never removed from the semantic graph.
  const degree=new Map(nodes.map(n=>[n.id,0])),index=new Map(nodes.map((n,i)=>[n.id,i]));
  for(const e of edges)if(!isFeedback(e)&&degree.has(e.target))degree.set(e.target,degree.get(e.target)+1);
  const queue=nodes.filter(n=>degree.get(n.id)===0),ordered=[];
  while(queue.length){queue.sort((a,b)=>index.get(a.id)-index.get(b.id));const n=queue.shift();ordered.push(n);for(const e of edges)if(!isFeedback(e)&&e.source===n.id&&degree.has(e.target)){degree.set(e.target,degree.get(e.target)-1);if(degree.get(e.target)===0)queue.push(nodes.find(n=>n.id===e.target));}}
  if(ordered.length!==nodes.length)throw new LayoutError('LAYOUT_CYCLE_ROLE_REQUIRED','Forward graph remains cyclic: explicit feedback roles required');
  return ordered;
}
function elkGraph(graph,nodes,options={}) {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const used=new Map();
  const edges=graph.edges.map((e,i)=>{
    if(!byId.has(e.source)||!byId.has(e.target))throw new LayoutError('EDGE_TARGET_MISSING',e.id);
    const s=portSide(e,true,i),t=portSide(e,false,i);
    const sourceKey=`${e.source}:${s}${options.portMode==='distributed'?`:${e.id}:out`:''}`,targetKey=`${e.target}:${t}${options.portMode==='distributed'?`:${e.id}:in`:''}`;
    used.set(sourceKey,{node:e.source,side:s});used.set(targetKey,{node:e.target,side:t});
    return {id:e.id,sources:[sourceKey],targets:[targetKey],layoutOptions:{'elk.layered.priority.direction':isFeedback(e)?'0':'10'},...(e.label?{labels:[{id:`${e.id}:label`,text:e.label,width:measure(e.label,12).width+12,height:22}]}:{})};
  });
  return {id:graph.id,layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.randomSeed':'1','elk.padding':'[top=24,left=24,bottom=24,right=24]','elk.spacing.nodeNode':'48','elk.spacing.edgeNode':'18','elk.spacing.edgeEdge':'12','elk.layered.spacing.nodeNodeBetweenLayers':'56','elk.layered.spacing.edgeNodeBetweenLayers':'20','elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES','elk.layered.cycleBreaking.strategy':'MODEL_ORDER','elk.layered.feedbackEdges':'true','elk.layered.mergeEdges':'false','elk.layered.edgeLabels.sideSelection':'ALWAYS_DOWN'},children:forwardOrder(nodes,graph.edges).map(n=>({id:n.id,width:n.width,height:n.height,layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:[...used.entries()].filter(([,v])=>v.node===n.id).map(([id,{side}])=>{
    const siblings=[...used.entries()].filter(([,v])=>v.node===n.id&&v.side===side).map(([key])=>key),offset=siblings.length>1?(siblings.indexOf(id)/(siblings.length-1)-.5)*Math.min(100,n.width-64):0;
    return {id,width:0,height:0,x:side==='WEST'?0:side==='EAST'?n.width:n.width/2+(n.kind==='decision'?0:offset),y:side==='NORTH'?0:side==='SOUTH'?n.height:n.height/2,layoutOptions:{'elk.port.side':side}};
  })})),edges};
}

async function runElk(graph,timeoutMs=5000) {
  return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./elk-worker.mjs',import.meta.url));
    const timer=setTimeout(()=>{worker.terminate();reject(new LayoutError('LAYOUT_TIMEOUT',`ELK > ${timeoutMs} ms`));},timeoutMs);
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    worker.once('error',e=>{finish();reject(e);});
    worker.once('message',m=>{finish();m.ok?resolve(m.graph):reject(new LayoutError('ELK_FAILURE',m.error));});
    worker.postMessage(graph);
  });
}

function placeLabels(scene) {
  const occupied=[];
  for(const edge of scene.edges) {
    if(!edge.label)continue;
    const w=measure(edge.label,12).width+12,h=22,candidates=[];
    if(edge.elkLabel)candidates.push(bbox(edge.elkLabel.x,edge.elkLabel.y,w,h));
    const segments=edge.points.slice(1).map((b,i)=>({a:edge.points[i],b,len:Math.abs(b.x-edge.points[i].x)+Math.abs(b.y-edge.points[i].y)})).sort((a,b)=>b.len-a.len);
    for(const {a,b} of segments) {
      for(const ratio of [.5,.25,.75]) {
        const cx=a.x+(b.x-a.x)*ratio,cy=a.y+(b.y-a.y)*ratio;
        if(Math.abs(a.y-b.y)<EPS){candidates.push(bbox(cx-w/2,cy-h-5,w,h),bbox(cx-w/2,cy+5,w,h));}
        else{candidates.push(bbox(cx+7,cy-h/2,w,h),bbox(cx-w-7,cy-h/2,w,h));}
      }
    }
    edge.labelBox=candidates.find(r=>!scene.nodes.some(n=>overlaps(r,n,6))&&!occupied.some(l=>overlaps(r,l,4))&&!scene.edges.some(e=>e.points.slice(1).some((b,i)=>segmentRect(e.points[i],b,r))));
    if(edge.labelBox)occupied.push(edge.labelBox);
    else scene.diagnostics.push({code:'EDGE_LABEL_NO_SPACE',edgeId:edge.id});
  }
}

export function validateScene(scene) {
  const errors=[];
  for(let i=0;i<scene.nodes.length;i++){
    const n=scene.nodes[i];
    for(let j=i+1;j<scene.nodes.length;j++)if(overlaps(n,scene.nodes[j]))errors.push({code:'NODE_OVERLAP',nodes:[n.id,scene.nodes[j].id]});
    for(const r of n.ink||[])if(!corners(r).every(p=>pointIn(p,n.polygon)))errors.push({code:'TEXT_OUTSIDE_SHAPE',nodeId:n.id});
  }
  for(const e of scene.edges){
    if(e.points.length<2){errors.push({code:'EDGE_ROUTE_MISSING',edgeId:e.id});continue;}
    e.points.slice(1).forEach((b,i)=>{
      const a=e.points[i];
      if(Math.abs(a.x-b.x)>EPS && Math.abs(a.y-b.y)>EPS)errors.push({code:'EDGE_NOT_ORTHOGONAL',edgeId:e.id});
      for(const n of scene.nodes)if(n.id!==e.source && n.id!==e.target && segmentPolygon(a,b,n.polygon))errors.push({code:'EDGE_THROUGH_SHAPE',edgeId:e.id,nodeId:n.id});
    });
    if(e.label && !e.labelBox)errors.push({code:'EDGE_LABEL_MISSING',edgeId:e.id});
    if(e.labelBox){
      for(const n of scene.nodes)if(overlaps(e.labelBox,n))errors.push({code:'LABEL_OVERLAPS_SHAPE',edgeId:e.id,nodeId:n.id});
      for(const other of scene.edges)if(other.labelBox&&other.id<e.id&&overlaps(e.labelBox,other.labelBox))errors.push({code:'LABEL_OVERLAP',edges:[e.id,other.id]});
    }
  }
  return errors;
}

export async function layoutGraph(graph,options={}) {
  const start=performance.now();
  if(!graph?.id||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw new LayoutError('GRAPH_INVALID','Invalid graph');
  if(new Set(graph.nodes.map(n=>n.id)).size!==graph.nodes.length||new Set(graph.edges.map(e=>e.id)).size!==graph.edges.length)throw new LayoutError('GRAPH_DUPLICATE_ID','Duplicate ID');
  const model=structuredClone(graph),nodes=model.nodes.map(sizedNode);
  const measuredAt=performance.now();
  const out=await runElk(elkGraph(model,nodes,options),options.timeoutMs||5000);
  const scene={schemaVersion:1,id:graph.id,title:graph.title||graph.id,graphDigest:hash(model),font:fontInfo,fontSize,nodes:out.children.map(p=>({...nodes.find(n=>n.id===p.id),x:num(p.x),y:num(p.y)})),edges:out.edges.map(e=>{const original=model.edges.find(v=>v.id===e.id);return {...original,points:(e.sections||[]).flatMap(s=>[s.startPoint,...s.bendPoints||[],s.endPoint]).map(p=>({x:num(p.x),y:num(p.y)})),elkLabel:e.labels?.[0]};}),diagnostics:[]};
  placeLabels(scene);
  // Normalize the complete scene, including label bounds, then add 24px margin.
  const all=scene.nodes.flatMap(n=>corners(n)).concat(scene.edges.flatMap(e=>e.points.map(p=>[p.x,p.y]))).concat(scene.edges.flatMap(e=>e.labelBox?corners(e.labelBox):[]));
  const minX=Math.min(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),dx=24-minX,dy=24-minY;
  scene.width=Math.ceil(Math.max(...all.map(p=>p[0]))-minX+48);scene.height=Math.ceil(Math.max(...all.map(p=>p[1]))-minY+48);
  const primitives=[];
  for(const n of scene.nodes){n.x=num(n.x+dx);n.y=num(n.y+dy);n.polygon=shapePolygon(n);n.ink=[];primitives.push({d:polygonPath(n.polygon),fill:n.kind==='decision'?'#e9f2ff':n.kind==='terminator'?'#edf6f0':'#ffffff',stroke:'#344260',strokeWidth:1.5,role:'node',owner:n.id});if(n.kind==='call')for(const x of [n.x+8,n.x+n.width-8])primitives.push({d:`M${x} ${n.y}V${n.y+n.height}`,stroke:'#344260',strokeWidth:1.5,role:'call-decoration',owner:n.id});}
  const routes=[];
  for(const e of scene.edges){
    e.points=e.points.map(p=>({x:num(p.x+dx),y:num(p.y+dy)}));
    if(e.labelBox){e.labelBox.x=num(e.labelBox.x+dx);e.labelBox.y=num(e.labelBox.y+dy);}
    const d=e.points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');
    routes.push({d,stroke:'#344260',strokeWidth:1.5,role:'edge',owner:e.id});
    const b=e.points.at(-1),a=e.points.at(-2);
    if(a&&b){const angle=Math.atan2(b.y-a.y,b.x-a.x),len=8,half=3.5;routes.push({d:polygonPath([[b.x,b.y],[b.x-len*Math.cos(angle)+half*Math.sin(angle),b.y-len*Math.sin(angle)-half*Math.cos(angle)],[b.x-len*Math.cos(angle)-half*Math.sin(angle),b.y-len*Math.sin(angle)+half*Math.cos(angle)]]),fill:'#344260',role:'arrow',owner:e.id});}
  }
  // Routes first, shapes cover shared endpoint seams, text last.
  scene.primitives=[...routes,...primitives];
  for(const n of scene.nodes)n.lines.forEach((line,i)=>{const t=glyphPrimitives(line,n.x+n.width/2,n.y+n.height/2+(i-(n.lines.length-1)/2)*lineHeight);n.ink.push(...t.ink);scene.primitives.push(...t.primitives.map(p=>({...p,owner:n.id})));});
  for(const e of scene.edges)if(e.labelBox){scene.primitives.push({d:rectPath(e.labelBox),fill:'#ffffff',role:'label-background',owner:e.id});const t=glyphPrimitives(e.label,e.labelBox.x+e.labelBox.width/2,e.labelBox.y+e.labelBox.height/2,12);scene.primitives.push(...t.primitives.map(p=>({...p,owner:e.id})));}
  scene.diagnostics.push(...validateScene(scene));scene.status=scene.diagnostics.length?'rejected':'ready';
  const canonical={...scene};delete canonical.timings;
  scene.sceneDigest=hash(canonical);
  scene.timings={measurementMs:num(measuredAt-start),totalMs:num(performance.now()-start)};
  return scene;
}

export function sceneSVG(scene,{diagnostic=false}={}) {
  if(scene.status!=='ready'&&!diagnostic)throw new LayoutError('SCENE_NOT_READY',JSON.stringify(scene.diagnostics));
  const metadata={schemaVersion:scene.schemaVersion,graphDigest:scene.graphDigest,sceneDigest:scene.sceneDigest,font:scene.font,status:scene.status,labels:scene.nodes.map(n=>({id:n.id,text:n.label})),edgeLabels:scene.edges.filter(e=>e.label).map(e=>({id:e.id,text:e.label}))};
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><title>${xml(scene.title)}</title><metadata>${xml(JSON.stringify(metadata))}</metadata><rect width="100%" height="100%" fill="#ffffff"/>${scene.primitives.map(p=>`<path d="${xml(p.d)}"${p.transform?` transform="matrix(${p.transform.join(' ')})"`:''} fill="${p.fill||'none'}"${p.stroke?` stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linejoin="round" stroke-linecap="butt"`:''}/>`).join('')}</svg>`;
}

export async function exportScene(scene,outprefix,options={}) {
  if(scene.status!=='ready')throw new LayoutError('SCENE_NOT_READY',JSON.stringify(scene.diagnostics));
  const formats=options.formats||['svg','pdf','png'];
  const scale=options.pngScale||1,pngW=Math.ceil(scene.width*scale),pngH=Math.ceil(scene.height*scale);
  if(formats.includes('png')&&(pngW>16384||pngH>16384||pngW*pngH>64_000_000))throw new LayoutError('PNG_SIZE_LIMIT',`${pngW}×${pngH}`);
  if(formats.includes('pdf')&&(scene.width*.75>14400||scene.height*.75>14400))throw new LayoutError('PDF_PAGE_SIZE_LIMIT','Native-size page > 14400pt; pagination required');
  fs.mkdirSync(path.dirname(outprefix),{recursive:true});
  const svg=sceneSVG(scene),paths={scene:`${outprefix}.scene.json`,...(formats.includes('svg')?{svg:`${outprefix}.svg`}:{}),...(formats.includes('pdf')?{pdf:`${outprefix}.pdf`}:{}),...(formats.includes('png')?{png:`${outprefix}.png`}:{})};
  fs.writeFileSync(paths.scene,JSON.stringify(scene,null,2));if(paths.svg)fs.writeFileSync(paths.svg,svg);
  const pngStart=performance.now();
  const png=paths.png?new Resvg(svg,{fitTo:{mode:'zoom',value:scale},font:{loadSystemFonts:false}}).render():null;
  if(png)fs.writeFileSync(paths.png,png.asPng());const pngMs=performance.now()-pngStart;
  // Native-sized diagnostic PDF, not A4 print pagination. Same path primitives.
  const pdfStart=performance.now();
  if(paths.pdf)await new Promise((resolve,reject)=>{
    const stream=fs.createWriteStream(paths.pdf),doc=new PDFDocument({size:[scene.width*.75,scene.height*.75],margin:0,compress:true,info:{Title:scene.title,Subject:`FlowSketch scene ${scene.sceneDigest}; glyph outlines; not an A4 print-layout test`,CreationDate:new Date('2026-01-01T00:00:00Z'),ModDate:new Date('2026-01-01T00:00:00Z')}});
    stream.once('finish',resolve);stream.once('error',reject);doc.once('error',reject);doc.pipe(stream);doc.scale(.75);doc.rect(0,0,scene.width,scene.height).fill('#ffffff');
    for(const p of scene.primitives){doc.save();if(p.transform)doc.transform(...p.transform);if(p.stroke)doc.lineWidth(p.strokeWidth).lineJoin('round').lineCap('butt').strokeColor(p.stroke);if(p.fill)doc.fillColor(p.fill);doc.path(p.d);if(p.fill&&p.stroke)doc.fillAndStroke();else if(p.fill)doc.fill();else doc.stroke();doc.restore();}
    doc.end();
  });
  return {paths,sceneDigest:scene.sceneDigest,png:png?{width:png.width,height:png.height,ms:num(pngMs)}:null,pdfMs:num(performance.now()-pdfStart),textPolicy:'glyph outlines from bundled font; SVG metadata keeps original Unicode; PDF text is not selectable',pdfPolicy:'single native-sized vector page; A4/A3 pagination and minimum print text size not implemented in this spike'};
}

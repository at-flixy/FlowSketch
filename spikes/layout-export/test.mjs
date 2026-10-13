import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutGraph,validateScene,exportScene,wrapText,measure,hash} from './index.mjs';
import {sumOdd,longRussian} from './fixtures.mjs';

test('Long prose uses words; an unspaced Cyrillic identifier wraps without clipping',()=>{
  const text='Проверить состояние переменнаяСОченьДлиннымНепрерывнымИдентификатором';
  const lines=wrapText(text,140);
  assert(lines.length>2);assert(lines.every(l=>measure(l).width<=140+.001));
  assert.equal(lines.join('').replaceAll(' ',''),text.replaceAll(' ',''));
});
test('Source tabs and CRLF are display whitespace, not font errors',()=>{
  assert.deepEqual(wrapText('int\tvalue = 1;\r\nreturn value;'),wrapText('int    value = 1;\nreturn value;'));
});
test('True diamond area is enforced, not only a bounding rectangle',async()=>{
  const scene=await layoutGraph(longRussian);
  assert.equal(scene.status,'ready',JSON.stringify(scene.diagnostics));
  const broken=structuredClone(scene),diamond=broken.nodes.find(n=>n.kind==='decision');
  diamond.ink=[{x:diamond.x+2,y:diamond.y+2,width:10,height:10}];
  assert(validateScene(broken).some(d=>d.code==='TEXT_OUTSIDE_SHAPE'));
});
test('An unrelated shape crossing is detected and rejected export cannot pass',async()=>{
  const scene=await layoutGraph(sumOdd);
  assert.equal(scene.nodes.length,9);assert.equal(scene.edges.length,10);
  const broken=structuredClone(scene),e=broken.edges[0],other=broken.nodes.find(n=>n.id!==e.source&&n.id!==e.target);
  e.points=[{x:other.x-5,y:other.y+other.height/2},{x:other.x+other.width+5,y:other.y+other.height/2}];
  broken.diagnostics=validateScene(broken);broken.status='rejected';
  assert(broken.diagnostics.some(d=>d.code==='EDGE_THROUGH_SHAPE'));
  await assert.rejects(exportScene(broken,'should-not-exist'),e=>e.code==='SCENE_NOT_READY');
});
test('The semantic graph stays immutable, cycles remain edges, result is deterministic',async()=>{
  const before=hash(sumOdd),a=await layoutGraph(sumOdd),b=await layoutGraph(sumOdd);
  assert.equal(hash(sumOdd),before);assert.equal(a.sceneDigest,b.sceneDigest);
  assert(a.edges.some(e=>e.source==='n6'&&e.target==='n2'&&e.role==='back'));
  assert(a.edges.some(e=>e.source==='n4'&&e.target==='n6'&&e.role==='continue'));
  const byId=new Map(a.nodes.map(n=>[n.id,n]));
  assert(byId.get('n0').y<byId.get('n2').y,'Entry must appear before the loop condition');
  assert(byId.get('n2').y<byId.get('n3').y,'Loop condition must appear before the body');
});
test('PNG caps are checked before a native allocation or file write',async()=>{
  const scene=await layoutGraph(longRussian);scene.width=16385;scene.status='ready';
  await assert.rejects(exportScene(scene,'should-not-exist'),e=>e.code==='PNG_SIZE_LIMIT');
});
test('Unsupported glyphs and invalid graph references give explicit failure',async()=>{
  const unsupported=structuredClone(longRussian);unsupported.nodes[0].label='😀';
  await assert.rejects(layoutGraph(unsupported),e=>e.code==='FONT_GLYPH_MISSING');
  const missing=structuredClone(sumOdd);missing.edges[0].target='not-a-node';
  await assert.rejects(layoutGraph(missing),e=>e.code==='EDGE_TARGET_MISSING');
  const unannotated=structuredClone(sumOdd);unannotated.edges.find(e=>e.role==='back').role='next';
  await assert.rejects(layoutGraph(unannotated),e=>e.code==='LAYOUT_CYCLE_ROLE_REQUIRED');
});

const n=(id,kind,label)=>({id,kind,label}),e=(id,source,target,role='next',label='',layoutHint)=>({id,source,target,role,label,...layoutHint?{layoutHint}: {}});
test('While continue feedback hint keeps semantic continue, condition precedes body',async()=>{
  const graph={id:'while-continue-hint',nodes:[n('s','terminator','Начало'),n('c','decision','i < n'),n('b','process','continue;'),n('z','terminator','Конец')],edges:[e('a','s','c'),e('b','c','b','true','Да'),e('c','b','c','continue','','back'),e('d','c','z','false','Нет')]};
  const scene=await layoutGraph(graph);assert.equal(scene.status,'ready',JSON.stringify(scene.diagnostics));
  assert.equal(scene.edges.find(e=>e.id==='c').role,'continue');assert.equal(scene.edges.find(e=>e.id==='c').layoutHint,'back');
  assert(scene.nodes.find(n=>n.id==='c').y<scene.nodes.find(n=>n.id==='b').y);
});
test('Do-while continue stays forward to the lower condition, true feedback stays true',async()=>{
  const graph={id:'do-while-continue-hint',nodes:[n('s','terminator','Начало'),n('b','process','continue;'),n('c','decision','i < n'),n('z','terminator','Конец')],edges:[e('a','s','b'),e('b','b','c','continue'),e('c','c','b','true','Да','back'),e('d','c','z','false','Нет')]};
  const scene=await layoutGraph(graph);assert.equal(scene.status,'ready',JSON.stringify(scene.diagnostics));
  assert(scene.nodes.find(n=>n.id==='b').y<scene.nodes.find(n=>n.id==='c').y);
  assert.equal(scene.edges.find(e=>e.id==='b').layoutHint,undefined);assert.equal(scene.edges.find(e=>e.id==='c').role,'true');
});
test('Empty while true self-loop has a routed arrow without changing the true role',async()=>{
  const graph={id:'empty-while-hint',nodes:[n('s','terminator','Начало'),n('c','decision','i < n'),n('z','terminator','Конец')],edges:[e('a','s','c'),e('b','c','c','true','Да','back'),e('d','c','z','false','Нет')]};
  const scene=await layoutGraph(graph);assert.equal(scene.status,'ready',JSON.stringify(scene.diagnostics));
  const loop=scene.edges.find(e=>e.id==='b');assert.equal(loop.role,'true');assert(loop.points.length>=4);assert(scene.primitives.some(p=>p.role==='arrow'&&p.owner==='b'));
});

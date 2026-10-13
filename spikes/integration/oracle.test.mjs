import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySumOdd} from './verify-sum-odd.mjs';

// Hand-authored fixture follows the specification, not an analyzer snapshot.
const golden={
 nodes:[['start','terminator','Начало'],['s0','process','int s = 0'],['i0','process','int i = 1'],['outer','decision','i <= n'],['inner','decision','i % 2 == 0'],['cont','process','continue'],['add','process','s += i'],['inc','process','++i'],['ret','process','return s'],['end','terminator','Конец']].map(([id,kind,label])=>({id,kind,label,sourceRange:{}})),
 edges:[['start','s0','normal'],['s0','i0','normal'],['i0','outer','normal'],['outer','inner','true'],['outer','ret','false'],['inner','cont','true'],['inner','add','false'],['cont','inc','continue'],['add','inc','normal'],['inc','outer','back'],['ret','end','return']].map(([source,target,role],i)=>({id:'e'+i,source,target,role}))
};
test('Independent oracle accepts the required control-flow graph',()=>assert.equal(verifySumOdd(golden).passed,true));
test('Reject continue incorrectly bypassing for increment',()=>{const g=structuredClone(golden);g.edges.find(e=>e.source==='cont').target='outer';assert.throws(()=>verifySumOdd(g));});
test('Reject loop back incorrectly repeating initialization',()=>{const g=structuredClone(golden);g.edges.find(e=>e.source==='inc').target='i0';assert.throws(()=>verifySumOdd(g));});
test('Reject return with an ordinary continuation',()=>{const g=structuredClone(golden);g.edges.push({id:'extra',source:'ret',target:'add',role:'normal'});assert.throws(()=>verifySumOdd(g));});
test('Reject lost false branch on outer condition',()=>{const g=structuredClone(golden);g.edges=g.edges.filter(e=>!(e.source==='outer'&&e.role==='false'));assert.throws(()=>verifySumOdd(g));});

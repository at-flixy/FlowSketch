import assert from 'node:assert/strict';

// Independent source-level oracle for the approved example. It must not be
// populated from the implementation's output or from a saved snapshot of it.
export function verifySumOdd(graph) {
  const nodes = graph.nodes;
  const edges = graph.edges;
  assert(Array.isArray(nodes) && Array.isArray(edges), 'Graph collections missing');
  const ids = new Set(nodes.map(n => n.id));
  assert.equal(ids.size, nodes.length, 'Duplicate node IDs');
  edges.forEach(e => assert(ids.has(e.source) && ids.has(e.target), 'Dangling edge'));
  const normalize = label => String(label).replace(/\s+/g, '').replace(/;+$/, '');
  const find = pattern => {
    const matches = nodes.filter(n => pattern.test(normalize(n.label)));
    assert.equal(matches.length, 1, `Expected one source node ${pattern}`);
    return matches[0];
  };
  const s0 = find(/^(int)?s=0$/);
  const i0 = find(/^(int)?i=1$/);
  const outer = find(/^i<=n$/);
  const inner = find(/^i%2==0$/);
  const add = find(/^s\+=i$/);
  const increment = find(/^\+\+i$/);
  const returned = find(/^returns$/);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outgoing = id => edges.filter(e => e.source === id);
  const branch = (node, truth) => {
    const aliases = truth ? ['true','yes','да','then'] : ['false','no','нет','else'];
    const candidates = outgoing(node.id).filter(e => aliases.includes(String(e.role ?? '').toLowerCase()) || aliases.includes(String(e.label ?? '').toLowerCase()));
    assert.equal(candidates.length, 1, `Expected one ${truth} branch from ${node.label}`);
    return candidates[0];
  };
  const allowedIntermediate = node => node.synthetic === true || node.kind === 'junction' || normalize(node.label) === 'continue';
  const reachesWithoutOtherAction = (firstEdge, target) => {
    const seen = new Set();
    const visit = id => {
      if (id === target.id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const n = byId.get(id);
      if (!n || !allowedIntermediate(n)) return false;
      return outgoing(id).some(e => visit(e.target));
    };
    assert(visit(firstEdge.target), `Required path to ${target.label} missing`);
  };
  const uniqueNext = (from, to) => {
    const list = outgoing(from.id);
    assert.equal(list.length, 1, `Unexpected successors of ${from.label}`);
    reachesWithoutOtherAction(list[0], to);
  };
  uniqueNext(s0, i0);
  uniqueNext(i0, outer);
  reachesWithoutOtherAction(branch(outer, true), inner);
  reachesWithoutOtherAction(branch(outer, false), returned);
  reachesWithoutOtherAction(branch(inner, true), increment);
  reachesWithoutOtherAction(branch(inner, false), add);
  uniqueNext(add, increment);
  uniqueNext(increment, outer);
  assert(!outgoing(increment.id).some(e => e.target === i0.id), 'Loop incorrectly repeats initialization');
  const returnEdges = outgoing(returned.id);
  assert.equal(returnEdges.length, 1, 'Return must lead only to the function ending');
  const ending = byId.get(returnEdges[0].target);
  assert(ending && (ending.kind === 'terminator' || ending.kind === 'end'), 'Return has a nonterminal successor');
  assert.equal(outgoing(ending.id).length, 0, 'End has an outgoing edge');
  assert.equal(outgoing(outer.id).length, 2, 'For condition must have two branches');
  assert.equal(outgoing(inner.id).length, 2, 'Inner condition must have two branches');
  const semantic = [s0,i0,outer,inner,add,increment,returned];
  assert(semantic.every(n => n.sourceRange), 'Source mapping missing');
  return {passed: true, requiredSemanticNodes: semantic.length, nodes: nodes.length, edges: edges.length,
    scope: 'Independent approved sumOdd control-flow oracle; not full C++17 coverage'};
}

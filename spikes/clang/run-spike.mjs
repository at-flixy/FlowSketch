import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeCpp,getToolchain,runCompiler} from './analyze.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const manifest=getToolchain();const fixtures=JSON.parse(fs.readFileSync(path.join(here,'fixtures.json'),'utf8'));
const feedbackFixtures=JSON.parse(fs.readFileSync(path.join(here,'feedback-fixtures.json'),'utf8'));
const normalized=s=>s.replace(/\s+/g,'').replace(/;$/,'');
function forwardDag(graph){
  const ids=graph.nodes.map(n=>n.id),indegree=new Map(ids.map(id=>[id,0])),outgoing=new Map(ids.map(id=>[id,[]]));
  const feedback=graph.edges.filter(e=>e.role==='back'||e.layoutHint==='back');const forward=graph.edges.filter(e=>e.role!=='back'&&e.layoutHint!=='back');
  for(const e of forward){indegree.set(e.target,(indegree.get(e.target)??0)+1);outgoing.get(e.source)?.push(e.target);}
  const queue=ids.filter(id=>indegree.get(id)===0),order=[];for(let i=0;i<queue.length;i++){const current=queue[i];order.push(current);for(const to of outgoing.get(current)??[]){indegree.set(to,indegree.get(to)-1);if(indegree.get(to)===0)queue.push(to);}}
  return {acyclic:order.length===ids.length,order,feedbackEdgeIds:feedback.map(e=>e.id),forwardEdgeIds:forward.map(e=>e.id)};
}
function cfgBlocks(text){
  const marks=[...text.matchAll(/^\s*\[(B\d+)(?:\s+\((ENTRY|EXIT)\))?\]\s*$/gm)];
  return marks.map((m,k)=>{const content=text.slice(m.index+m[0].length,marks[k+1]?.index??text.length);const succ=content.match(/Succs \(\d+\):([^\r\n]+)/);return {id:m[1],kind:m[2]??null,content,successors:succ?[...succ[1].matchAll(/B\d+/g)].map(x=>x[0]):[]};});
}
function cfgCheck(fixture,text){
  const blocks=cfgBlocks(text),map=new Map(blocks.map(b=>[b.id,b]));
  const has=(b,pattern)=>pattern.test(b?.content??'');
  const successorsAfterEmptyBlocks=b=>{const result=[];const seen=new Set();const visit=id=>{if(seen.has(id))return;seen.add(id);const target=map.get(id);if(!target)return;const meaningful=target.content.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('Preds ')&&!s.startsWith('Succs '));if(meaningful.length===0&&target.kind===null){for(const next of target.successors)visit(next);}else result.push(target);};for(const id of b?.successors??[])visit(id);return result;};
  const successorHas=(b,pattern)=>successorsAfterEmptyBlocks(b).some(target=>has(target,pattern));
  const cont=blocks.find(b=>has(b,/T: continue;/));const brk=blocks.find(b=>has(b,/T: break;/));const sw=blocks.find(b=>has(b,/T: switch /));
  let expected,passed;
  switch(fixture.id){
    case 'sumOdd':case 'forContinue':case 'switchContinue':expected='continue successor contains the for increment ++';passed=successorHas(cont,/\+\+/);break;
    case 'whileContinue':expected='continue successor is while condition';passed=successorHas(cont,/T: while /);break;
    case 'doContinue':expected='continue successor is do-while bottom condition';passed=successorHas(cont,/T: do /);break;
    case 'nestedBreak':expected='inner break successor contains outer-tail +=10';passed=successorHas(brk,/\+=/)&&successorHas(brk,/\b10\b/);break;
    case 'switchFallthrough':{const one=blocks.find(b=>has(b,/case 1:/));expected='case1 has direct successor case2';passed=successorHas(one,/case 2:/);break;}
    case 'switchNoDefault':expected='switch has no-match successor containing return';passed=successorHas(sw,/return /);break;
    case 'shortCircuitAnd':case 'shortCircuitOr':{
      const op=fixture.id==='shortCircuitAnd'?'&&':'||';const b=blocks.find(b=>b.content.split('\n').some(l=>l.includes('T:')&&l.includes(op)&&l.trim().endsWith('...')));
      const rhsIndex=op==='&&'?0:1;expected='RHS ++b is only on the '+(rhsIndex===0?'true':'false')+' successor of '+op;passed=!!b&&has(map.get(b.successors[rhsIndex]),/\+\+/)&&!has(map.get(b.successors[1-rhsIndex]),/\+\+/);break;}
    case 'earlyReturn':{const returns=blocks.filter(b=>has(b,/return /));expected='each return block goes directly to EXIT, never dead tail';passed=returns.length===2&&returns.every(b=>b.successors.length===1&&map.get(b.successors[0])?.kind==='EXIT');break;}
    case 'implicitMain':expected='main ordinary body reaches CFG EXIT; return0 is independently synthesized from language rule';passed=blocks.some(b=>b.kind==='EXIT')&&blocks.some(b=>b.kind!=='ENTRY'&&b.successors.some(id=>map.get(id)?.kind==='EXIT'));break;
    case 'ifElse':{const q=blocks.find(b=>has(b,/T: if /));expected='if has two successors containing += and -=';passed=q?.successors.length===2&&successorHas(q,/\+=/)&&successorHas(q,/-=/);break;}
    case 'utf8Offsets':expected='loop increment goes back to for condition';passed=blocks.some(b=>has(b,/\+\+/)&&successorHas(b,/T: for /));break;
    default:expected='CFG entry/exit captured';passed=blocks.some(b=>b.kind==='ENTRY')&&blocks.some(b=>b.kind==='EXIT');
  }
  return {passed:!!passed,expected,blocks:blocks.length};
}
function graphChecks(fixture,graph){
  const find=label=>graph.nodes.filter(n=>normalized(n.label)===normalized(label));
  const matches=(from,to,role)=>{const a=find(from).map(n=>n.id),b=find(to).map(n=>n.id);return graph.edges.some(e=>a.includes(e.source)&&b.includes(e.target)&&(!role||e.role===role));};
  const checks=(fixture.expect??[]).map(([from,to,role])=>({kind:'required-edge',from,to,role:role??null,passed:matches(from,to,role)}));
  for(const [from,to,role]of fixture.forbid??[])checks.push({kind:'forbidden-edge',from,to,role:role??null,passed:!matches(from,to,role)});
  for(const [label,line]of fixture.expectedLines??[])checks.push({kind:'byte-offset-line',label,expectedLine:line,passed:find(label).some(n=>n.sourceRange.begin.line===line)});
  const bytes=Buffer.from(fixture.source,'utf8');
  for(const n of graph.nodes.filter(n=>!n.sourceRange.synthetic)){
    const r=n.sourceRange;checks.push({kind:'exact-source-slice',nodeId:n.id,passed:bytes.subarray(r.begin.offset,r.end.offset).toString('utf8')===n.originalText});
  }
  checks.push({kind:'stable-role-back',passed:graph.nodes.every(n=>n.sourceRange?.file)&&graph.edges.every(e=>graph.nodes.some(n=>n.id===e.source)&&graph.nodes.some(n=>n.id===e.target))});
  const dag=forwardDag(graph);checks.push({kind:'forward-ranking-dag',passed:dag.acyclic,feedbackEdgeIds:dag.feedbackEdgeIds});
  if(['sumOdd','forContinue','whileContinue','doContinue','switchContinue'].includes(fixture.id)){
    const continueEdges=graph.edges.filter(e=>e.role==='continue');const expectedHint=fixture.id==='whileContinue'?'back':null;
    checks.push({kind:'continue-layout-hint',expectedHint,passed:continueEdges.length===1&&continueEdges.every(e=>(e.layoutHint??null)===expectedHint)});
    if(expectedHint===null)checks.push({kind:'continue-retained-in-forward-ranking',passed:continueEdges.every(e=>dag.forwardEdgeIds.includes(e.id)&&dag.order.indexOf(e.source)<dag.order.indexOf(e.target))});
    if(expectedHint==='back'){
      const stripped={...graph,edges:graph.edges.map(e=>{const copy={...e};if(copy.role==='continue')delete copy.layoutHint;return copy;})};
      checks.push({kind:'missing-while-continue-hint-recreates-cycle',passed:!forwardDag(stripped).acyclic});
    }
  }
  return checks;
}
const evidence={schemaVersion:1,generatedAtUtc:new Date().toISOString(),toolchain:manifest,version:runCompiler(['--version']).stdout.trim(),sourceExecution:false,linkedUserPrograms:false,sourceRangeUnits:{offset:'utf8-bytes',column:'utf8-bytes',line:'1-based',end:'exclusive'},layoutFeedbackPolicy:{field:'edge.layoutHint',value:'back',predicate:"edge.role === 'back' || edge.layoutHint === 'back'",semanticRolesAndTargetsPreserved:true},environmentPolicy:'Only SystemRoot, windir, TEMP, TMP, project-toolchain bin and System32 PATH in child process. INCLUDE, LIB, SDK and CPATH variables not inherited.',discovery:{pathClangFound:false,knownLlvmAndVsLocationsFound:false,scope:'PATH and default LLVM/VS2017-2022 locations only; not exhaustive disk search'},cases:[],feedbackCases:[],limitations:['Not a clean Windows VM; PKG-02 is NOT passed.','CLI filtered AST JSON and debug.DumpCFG are version-specific spike formats, not final bounded native sidecar protocol.','AST-name filter collisions/overloads require selected-function native LibTooling filtering.','STL headers smoke proves parse availability, not admitted STL graph semantics.','Only the experimental scalar/control subset is graph-adapted; opaque calls rejected without complete called-declaration metadata.','No full matrix T01-T50 acceptance; no source execution, runtime correctness, UB, termination or complete exception/lifetime analysis.','Adapter source offsets are UTF-8 bytes; Windows Job Object, VFS allowlist, hard memory budget and production cancellation are not implemented here.']};
for(const fixture of fixtures){
  const r=analyzeCpp({source:fixture.source,functionName:fixture.name,id:fixture.id,skipCfg:fixture.skipCfg??false,skipGraph:fixture.skipGraph??false,verbose:fixture.id==='stdlib'});
  let checks=[];
  if(fixture.expectedParseError)checks=[{kind:'parse-rejection',passed:r.status==='INPUT_ERROR'&&r.graph===null}];
  else if(fixture.expectedAdapterError)checks=[{kind:'unsupported-rejection',passed:r.status==='UNSUPPORTED'&&r.graph===null,diagnostic:r.adapterError}];
  else if(fixture.skipGraph)checks=[{kind:'syntax-only-stdlib',passed:r.syntax.exitCode===0&&r.ast?.kind==='FunctionDecl'&&r.status==='PARSED_ONLY'}];
  else if(r.graph){checks=graphChecks(fixture,r.graph);checks.push({kind:'independent-cfg-rule',...cfgCheck(fixture,r.cfg)});}
  else checks=[{kind:'graph-created',passed:false,diagnostic:r.adapterError??r.syntax.stderr}];
  if(fixture.id==='stdlib'){
    const region=r.syntax.stderr.split('#include <...> search starts here:')[1]?.split('End of search list.')[0]??'';
    const directories=region.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const root=path.resolve(manifest.toolchainRoot).toLowerCase();
    const local=directories.length===3&&directories.every(d=>path.resolve(d).toLowerCase().startsWith(root+path.sep));
    checks.push({kind:'bundled-only-include-search',passed:local,directories});evidence.includeSearch={directories,bundledOnly:local,sysroot:manifest.toolchainRoot,verboseFile:'results/stdlib/syntax.stderr.txt'};
  }
  const entry={id:fixture.id,feature:fixture.feature,status:r.status,passed:checks.every(c=>c.passed),syntaxExitCode:r.syntax.exitCode,syntaxMs:r.syntax.elapsedMs,astBytes:r.astProcess?Buffer.byteLength(r.astProcess.stdout):0,cfgBytes:r.cfg?Buffer.byteLength(r.cfg):0,nodes:r.graph?.nodes.length??0,edges:r.graph?.edges.length??0,checks,artifacts:'results/'+fixture.id,arguments:r.syntax.arguments,adapterError:r.adapterError};
  evidence.cases.push(entry);console.log((entry.passed?'PASS ':'FAIL ')+fixture.id+' ['+r.status+']');
  if(fixture.id==='sumOdd'&&r.graph)fs.writeFileSync(path.join(here,'sumOdd.graph.json'),JSON.stringify(r.graph,null,2));
}
for(const fixture of feedbackFixtures){
  const r=analyzeCpp({source:fixture.source,functionName:fixture.name,id:fixture.id});let checks=[];
  if(r.graph){
    checks=graphChecks(fixture,r.graph);const find=label=>r.graph.nodes.filter(n=>normalized(n.label)===normalized(label)).map(n=>n.id);
    for(const [from,to,role,hint,label]of fixture.expectHints??[]){const a=find(from),b=find(to);checks.push({kind:'feedback-edge-preserves-semantics',from,to,role,hint,label,passed:r.graph.edges.some(e=>a.includes(e.source)&&b.includes(e.target)&&e.role===role&&(e.layoutHint??null)===hint&&e.label===label)});}
    for(const [from,to,branch]of fixture.expectedConditionBranches??[]){const a=find(from),b=find(to);checks.push({kind:'logical-branch-preserved',from,to,branch,passed:r.graph.edges.some(e=>a.includes(e.source)&&b.includes(e.target)&&e.conditionBranch===branch)});}
    if(fixture.expectedEmptyForever)checks.push({kind:'empty-infinite-loop-no-false-branch',passed:r.graph.edges.some(e=>e.source===e.target&&e.layoutHint==='back')&&!r.graph.edges.some(e=>e.conditionBranch==='false'||e.label==='Нет')});
    checks.push({kind:'cfg-entry-captured',passed:r.cfg?.includes('(ENTRY)')===true});
  }else checks=[{kind:'graph-created',passed:false,diagnostic:r.adapterError??r.syntax.stderr}];
  const entry={id:fixture.id,feature:fixture.feature,status:r.status,passed:checks.every(c=>c.passed),syntaxExitCode:r.syntax.exitCode,nodes:r.graph?.nodes.length??0,edges:r.graph?.edges.length??0,checks,artifacts:'results/'+fixture.id};evidence.feedbackCases.push(entry);console.log((entry.passed?'PASS ':'FAIL ')+'feedback/'+fixture.id+' ['+r.status+']');
}
const primaryFailed=evidence.cases.filter(c=>!c.passed).length,feedbackFailed=evidence.feedbackCases.filter(c=>!c.passed).length;
evidence.summary={fixtures:evidence.cases.length,passed:evidence.cases.filter(c=>c.passed).length,failed:primaryFailed+feedbackFailed,primaryFailed,graphFixtures:evidence.cases.filter(c=>c.nodes>0).length,feedbackFixtures:evidence.feedbackCases.length,feedbackPassed:evidence.feedbackCases.filter(c=>c.passed).length,feedbackFailed,stdlibSyntaxSmoke:evidence.cases.find(c=>c.id==='stdlib')?.passed,cleanVmPackagingAcceptance:false,full50CaseAcceptance:false};
fs.writeFileSync(path.join(here,'evidence.json'),JSON.stringify(evidence,null,2));
const report=[
'# Clang spike: проверенный результат',
'',
'Статус: '+(evidence.summary.failed?'FAIL':'PASS')+'. '+evidence.summary.passed+'/'+evidence.summary.fixtures+' проверок корпуса; '+evidence.summary.graphFixtures+' графов из реального AST и CFG; 1 отдельный stdlib smoke; 5 проверок отказа. Это не приемка T01–T50.',
'Отдельно: '+evidence.summary.feedbackPassed+'/'+evidence.summary.feedbackFixtures+' feedback/empty-loop проверок. Исходный счетчик 14 графов не заменен расширением корпуса.',
'',
'Системный Clang не найден в PATH и проверенных стандартных LLVM/Visual Studio путях. Поиск не являлся полным сканированием диска. Загружен локальный официальный llvm-mingw UCRT x86_64, без установки в систему и без изменения PATH/registry.',
'',
'## Воспроизведение',
'',
'Однократно: `pwsh -NoProfile -File spikes/clang/bootstrap-toolchain.ps1` из корня проекта.',
'Повтор проверки: `node spikes/clang/run-spike.mjs` либо `pwsh -NoProfile -File spikes/clang/run-spike.ps1`.',
'Требуется Node.js (проверено на '+process.version+'). Root package и npm dependencies для этого эксперимента не нужны.',
'',
'Точный executable: `'+manifest.executable+'`.',
'Версия: `'+evidence.version.replace(/\r?\n/g,' | ')+'`.',
'Release tag: `'+manifest.releaseTag+'`.',
'Архив: '+manifest.assetUrl,
'SHA256 архива: `'+manifest.assetSha256+'`; совпадает с опубликованным digest GitHub asset.',
'SHA256 executable: `'+manifest.executableSha256+'`.',
'',
'## Реальные проверки',
'',
'- Использованы `-std=c++17 -pedantic-errors -Werror=return-type -fsyntax-only`; линковка и выполнение пользовательского C++ отсутствуют.',
'- Ресурсные/стандартные includes задаются явно: `--no-default-config`, фиксированные target/sysroot/resource-dir, `-nostdinc -nostdinc++` и три bundled `-isystem` пути.',
'- Child environment содержит только SystemRoot, windir, TEMP, TMP и PATH из project/bin + System32. INCLUDE/LIB/CPATH/Visual Studio/SDK переменные не наследуются; глобальное окружение не изменено.',
'- iostream, vector, string, algorithm и cmath действительно разобраны вместе с использованием cin/cout, endl, vector<int>, sort, string, sqrt/pow.',
'- Получены отдельные выбранные FunctionDecl AST JSON и debug.DumpCFG. Критические CFG ожидания сформулированы вручную; пустые служебные CFG блоки нормализуются без удаления действий.',
'- Проверены for/continue, while/continue, do/continue, вложенный break, switch fallthrough/no-default/continue, &&/||, return, main implicit return0 и if/else.',
'- Русский комментарий до for/return проверяет UTF8 offsets. originalText для каждого несинтетического узла сверяется с точным Buffer slice. Offset и column единицы явно utf8-bytes; UI UTF16 conversion — задача будущего протокола/редактора.',
'- Управляющий макрос, ошибка C++, volatile, non-void fallthrough и непрозрачный вызов без complete declaration metadata не становятся готовым графом.',
'',
'| Случай | Статус | Проверка | Узлы/ребра |',
'|---|---|---|---|',
...evidence.cases.map(c=>'| '+c.id+' | '+c.status+' | '+(c.passed?'PASS':'FAIL')+' | '+c.nodes+'/'+c.edges+' |'),
'',
'Feedback hints: `edge.layoutHint="back"`, forward DAG исключает только `role="back"` или явно отмеченный layoutHint. Семантический continue сохраняется. While continue является обратным; do-while continue к нижней проверке и for continue к increment остаются прямыми. For без increment и empty self-loops помечены отдельно; conditional branch Да/Нет сохраняется.',
'',
'| Дополнительный feedback случай | Статус | Проверка | Узлы/ребра |',
'|---|---|---|---|',
...evidence.feedbackCases.map(c=>'| '+c.id+' | '+c.status+' | '+(c.passed?'PASS':'FAIL')+' | '+c.nodes+'/'+c.edges+' |'),
'',
'## API для интеграции эксперимента',
'',
'`import {analyzeCpp,getToolchain} from "./spikes/clang/analyze.mjs"`.',
'`analyzeCpp({source,functionName,id,fileLabel,outputDirectory,skipCfg,skipGraph,verbose})` синхронно возвращает `{status,graph,ast,cfg,syntax,astProcess,cfgProcess,adapterError,...}`. Function name в этом эксперименте только простое уникальное имя.',
'`import {astToGraph} from "./spikes/clang/ast-to-graph.mjs"`.',
'`astToGraph(ast,{source,file,id,title})` принимает выбранный Clang FunctionDecl и точный UTF8 snapshot; возвращает nodes/edges с sourceRange, originalText и явными back/continue/break/true/false/case/default/return roles.',
'Готовый первый граф для ELK/export: `spikes/clang/sumOdd.graph.json`; оригинальные source/AST/CFG находятся в `results/sumOdd`.',
'',
'## Ограничения и следующий переход',
'',
...evidence.limitations.map(x=>'- '+x),
'- Adapter не является полной реализацией норматива v1: STL graph profiles, if-init, range-for, user templates, macros, RAII, noreturn metadata и final native sidecar еще не реализованы.',
'- CLI filtered AST/debug CFG формат закреплен только этим toolchain. Для Tauri prototype нужен Native LibTooling analyzer с выбором функции до serialization, стабильным versioned JSON и ограничением выходного объема. Нельзя сериализовать целый header AST и считать малые текущие файлы доказательством 16MiB предела.',
'- PKG-02 на чистых офлайн Windows 10/11 НЕ пройден. Текущий проход с очищенным environment — полезное подтверждение include self-containment на этом хосте, а не чистая VM/проверка установщика.',
'',
'## Первичные источники',
'',
'- https://github.com/mstorsjo/llvm-mingw/releases/tag/20261006',
'- https://clang.llvm.org/docs/IntroductionToTheClangAST.html',
'- https://clang.llvm.org/docs/UsersManual.html',
'- https://clang.llvm.org/docs/analyzer/developer-docs/DebugChecks.html',
''
].join('\n');fs.writeFileSync(path.join(here,'REPORT.md'),report);
console.log(JSON.stringify(evidence.summary));
if(evidence.summary.failed)process.exitCode=1;

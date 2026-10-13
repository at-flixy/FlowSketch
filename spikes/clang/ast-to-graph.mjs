/** Experimental AST adapter, not the final native analyzer protocol or full C++17 implementation. */
export class UnsupportedAstError extends Error {
  constructor(message, astKind) { super(message); this.name='UnsupportedAstError'; this.astKind=astKind; }
}
const expressionKinds = new Set(['ImplicitCastExpr','ParenExpr','DeclRefExpr','IntegerLiteral','FloatingLiteral','CXXBoolLiteralExpr','StringLiteral','CharacterLiteral','BinaryOperator','CompoundAssignOperator','UnaryOperator','ConditionalOperator','CallExpr','ArraySubscriptExpr','UnaryExprOrTypeTraitExpr','CStyleCastExpr','CXXStaticCastExpr','ConstantExpr','InitListExpr','ImplicitValueInitExpr','CXXNullPtrLiteralExpr']);
const scalarTypes = new Set(['void','bool','char','signed char','unsigned char','short','unsigned short','int','unsigned int','long','unsigned long','long long','unsigned long long','float','double','long double']);
function walk(n,fn){if(!n||!n.kind)return;fn(n);for(const child of n.inner??[])walk(child,fn);}
function unwrap(n){while(n&&['ImplicitCastExpr','ParenExpr','ConstantExpr'].includes(n.kind)&&n.inner?.length===1)n=n.inner[0];return n;}
export function astToGraph(ast,{source,file='input.cpp',id=ast?.name??'function',title=ast?.name??'Функция'}={}) {
  if(typeof source!=='string')throw new TypeError('source must be the exact parsed UTF-8 source snapshot');
  if(ast?.kind!=='FunctionDecl')throw new UnsupportedAstError('One selected FunctionDecl is required',ast?.kind);
  const body=ast.inner?.find(n=>n.kind==='CompoundStmt');
  if(!body)throw new UnsupportedAstError('Selected function has no definition','FunctionDecl');
  const bytes=Buffer.from(source,'utf8');const nodes=[];const edges=[];let nodeSeq=0,edgeSeq=0;
  const abstractions=[];const diagnostics=[];
  const position=offset=>{const before=bytes.subarray(0,offset).toString('utf8');const lines=before.split('\n');return {offset,line:lines.length,column:Buffer.byteLength(lines.at(-1),'utf8')+1};};
  function range(n,synthetic=false){
    const b=n?.range?.begin,e=n?.range?.end;
    if(b?.spellingLoc||b?.expansionLoc||e?.spellingLoc||e?.expansionLoc)throw new UnsupportedAstError('Macro source mapping is not implemented in this spike',n.kind);
    if(!Number.isInteger(b?.offset)||!Number.isInteger(e?.offset))throw new UnsupportedAstError('Source offsets are missing',n?.kind);
    const end=e.offset+(e.tokLen??1);
    if(b.offset<0||end>bytes.length||end<b.offset)throw new UnsupportedAstError('Source range is outside the selected snapshot',n?.kind);
    return {file,begin:position(b.offset),end:position(end),endExclusive:true,offsetEncoding:'utf8-bytes',columnEncoding:'utf8-bytes',synthetic,originKind:n.kind};
  }
  const text=n=>{const r=range(n);return bytes.subarray(r.begin.offset,r.end.offset).toString('utf8').trim().replace(/;\s*$/,'');};
  function node(kind,label,origin,synthetic=false){const r=range(origin,synthetic);const result={id:'n'+(++nodeSeq),kind,label,sourceRange:r,originalText:synthetic?null:bytes.subarray(r.begin.offset,r.end.offset).toString('utf8'),astKind:origin.kind};nodes.push(result);return result.id;}
  function flow(value,role='normal'){return typeof value==='string'?{id:value,role}:value;}
  function edge(from,to,label='',role){const target=flow(to);const result={id:'e'+(++edgeSeq),source:from,target:target.id,label,role:role??target.role??'normal'};if(target.layoutHint==='back'||target.role==='back'||result.role==='back')result.layoutHint='back';edges.push(result);return result;}
  function scalar(t){if(/\bvolatile\b/.test(t??''))return false;const normalized=(t??'').replace(/\bconst\b/g,'').replace(/\s*\[[^\]]*\]/g,'').replace(/[&*]/g,'').replace(/\s+/g,' ').trim();return scalarTypes.has(normalized);}
  for(const parameter of ast.inner??[])if(parameter.kind==='ParmVarDecl'&&!scalar(parameter.type?.qualType))throw new UnsupportedAstError('Parameter type is outside scalar spike profile','ParmVarDecl');
  function validateExpression(n){
    walk(n,c=>{
      if(!expressionKinds.has(c.kind))throw new UnsupportedAstError('Expression node is outside the experimental allowlist: '+c.kind,c.kind);
      if(c.kind==='CallExpr')throw new UnsupportedAstError('Opaque calls require called-declaration metadata, which filtered CLI AST does not fully provide in this spike','CallExpr');
    });
  }
  function condition(n){
    n=unwrap(n);validateExpression(n);
    if(n.kind==='BinaryOperator'&&['&&','||'].includes(n.opcode)){
      const left=condition(n.inner[0]),right=condition(n.inner[1]);
      return {entry:left.entry,connect(yes,no){if(n.opcode==='&&'){left.connect(right.entry,no);right.connect(yes,no);}else{left.connect(yes,right.entry);right.connect(yes,no);}}};
    }
    const q=node('decision',text(n),n);
    return {entry:q,connect(yes,no){const t=flow(yes),f=flow(no);edge(q,t,'Да',t.role==='back'?'back':'true').conditionBranch='true';edge(q,f,'Нет',f.role==='back'?'back':'false').conditionBranch='false';}};
  }
  function simple(n,next){
    if(n.kind==='DeclStmt'){
      for(const d of n.inner??[]){if(d.kind!=='VarDecl'||!scalar(d.type?.qualType)||d.storageClass)throw new UnsupportedAstError('Only ordinary local scalar/array declarations are implemented in this spike',d.kind);for(const c of d.inner??[])validateExpression(c);}
    }else validateExpression(n);
    let containsCall=false;walk(n,c=>{if(c.kind==='CallExpr')containsCall=true;});
    const a=node(containsCall?'call':'process',text(n),n);edge(a,next);return a;
  }
  function compileList(items,next,ctx){let entry=flow(next);for(let k=items.length-1;k>=0;k--)entry=flow(compile(items[k],entry,ctx));return entry.id;}
  function compile(n,next,ctx){
    if(!n?.kind||n.kind==='NullStmt')return flow(next).id;
    if(n.kind==='CompoundStmt')return compileList(n.inner??[],next,ctx);
    if(n.kind==='AttributedStmt'){
      const inner=(n.inner??[]).filter(c=>!c.kind.endsWith('Attr'));if(inner.length!==1||inner[0].kind!=='NullStmt')throw new UnsupportedAstError('Only [[fallthrough]] attributed null statements are implemented',n.kind);return flow(next).id;
    }
    if(n.kind==='ReturnStmt'){
      for(const c of n.inner??[])validateExpression(c);
      const r=node('process',text(n),n);edge(r,exit,'','return');return r;
    }
    if(n.kind==='BreakStmt'||n.kind==='ContinueStmt'){
      const target=n.kind==='BreakStmt'?ctx.breakTarget:ctx.continueTarget;if(!target)throw new UnsupportedAstError('Jump has no enclosing target',n.kind);
      const a=node('process',text(n),n);edge(a,target,'',n.kind==='BreakStmt'?'break':'continue');return a;
    }
    if(n.kind==='IfStmt'){
      if(n.hasInit||n.hasVar)throw new UnsupportedAstError('if initializer is not implemented in this small adapter','IfStmt');
      const inner=n.inner??[];if(inner.length<2)throw new UnsupportedAstError('Unexpected IfStmt child layout','IfStmt');
      const q=condition(inner[0]);const yesId=compile(inner[1],next,ctx);const nextFlow=flow(next);const aliasFlow=value=>value===nextFlow.id&&(nextFlow.role==='back'||nextFlow.layoutHint==='back')?{id:value,layoutHint:'back'}:value;const yes=aliasFlow(yesId);const no=inner[2]?aliasFlow(compile(inner[2],next,ctx)):next;q.connect(yes,no);return q.entry;
    }
    if(n.kind==='ForStmt'){
      const [init,condVar,cond,inc,loopBody]=n.inner??[];if(!loopBody||condVar?.kind)throw new UnsupportedAstError('Unexpected/declaration-condition ForStmt layout','ForStmt');
      const q=cond?.kind?condition(cond):null;const header=q?.entry??node('connector','',n,true);
      const increment=inc?.kind?simple(inc,{id:header,role:'back'}):header;
      const bodyEntry=compile(loopBody,{id:increment,role:inc?.kind?'normal':'back'},{...ctx,breakTarget:next,continueTarget:{id:increment,...(!inc?.kind?{layoutHint:'back'}:{})}});
      const bodyFlow=bodyEntry===header?{id:bodyEntry,layoutHint:'back'}:bodyEntry;
      if(q)q.connect(bodyFlow,next);else edge(header,bodyFlow);
      return init?.kind?compile(init,header,ctx):header;
    }
    if(n.kind==='WhileStmt'){
      const inner=n.inner??[];if(inner.length!==2)throw new UnsupportedAstError('Declaration-condition while is outside spike','WhileStmt');
      const q=condition(inner[0]);const bodyEntry=compile(inner[1],{id:q.entry,role:'back'},{...ctx,breakTarget:next,continueTarget:{id:q.entry,layoutHint:'back'}});q.connect(bodyEntry===q.entry?{id:bodyEntry,layoutHint:'back'}:bodyEntry,next);return q.entry;
    }
    if(n.kind==='DoStmt'){
      const [loopBody,cond]=n.inner??[];const q=condition(cond);const bodyEntry=compile(loopBody,q.entry,{...ctx,breakTarget:next,continueTarget:q.entry});q.connect({id:bodyEntry,role:'back'},next);return bodyEntry;
    }
    if(n.kind==='SwitchStmt'){
      const [selector,switchBody]=n.inner??[];if(switchBody?.kind!=='CompoundStmt')throw new UnsupportedAstError('Unexpected switch layout','SwitchStmt');validateExpression(selector);
      const groups=[];let current=null;
      for(const item of switchBody.inner??[]){
        if(item.kind==='CaseStmt'||item.kind==='DefaultStmt'){
          current={labels:[],statements:[]};groups.push(current);let labelNode=item;
          while(labelNode?.kind==='CaseStmt'||labelNode?.kind==='DefaultStmt'){
            if(labelNode.kind==='DefaultStmt'){current.labels.push({label:'Иначе',role:'default'});labelNode=labelNode.inner?.[0];}
            else{if(labelNode.inner?.length!==2)throw new UnsupportedAstError('Nonstandard/range case is outside spike','CaseStmt');current.labels.push({label:'case '+text(labelNode.inner[0]),role:'case'});labelNode=labelNode.inner[1];}
          }
          if(labelNode?.kind)current.statements.push(labelNode);
        }else{if(!current)throw new UnsupportedAstError('Statements before first case are outside spike','SwitchStmt');current.statements.push(item);}
      }
      let following=flow(next);for(let k=groups.length-1;k>=0;k--){const entry=compileList(groups[k].statements,following,{...ctx,breakTarget:next});groups[k].entry=entry;following={id:entry,role:'fallthrough'};}
      const s=node('decision',text(selector),selector);for(const g of groups)for(const label of g.labels)edge(s,g.entry,label.label,label.role);
      if(!groups.some(g=>g.labels.some(l=>l.role==='default')))edge(s,next,'Нет совпадения','default');return s;
    }
    if(n.kind==='DeclStmt'||expressionKinds.has(n.kind))return simple(n,next);
    throw new UnsupportedAstError('Statement node outside implemented subset: '+n.kind,n.kind);
  }
  const isMain=ast.name==='main';const isVoid=ast.type?.qualType?.startsWith('void (');
  const exit=node('terminator',isMain?'Конец · return 0':'Конец',body,true);
  const start=node('terminator','Начало',body,true);const bodyEntry=compile(body,exit,{});edge(start,bodyEntry);
  const reachable=new Set();const queue=[start];while(queue.length){const cur=queue.pop();if(reachable.has(cur))continue;reachable.add(cur);for(const e of edges)if(e.source===cur)queue.push(e.target);}
  for(const n of nodes){n.reachable=reachable.has(n.id);if(!n.reachable)diagnostics.push({code:'UNREACHABLE_COMPONENT',nodeId:n.id,sourceRange:n.sourceRange});}
  if(!isMain&&!isVoid&&edges.some(e=>e.target===exit&&e.role!=='return'&&reachable.has(e.source)))throw new UnsupportedAstError('Non-void normal fallthrough requires explicit return','MISSING_RETURN');
  return {id,title,nodes,edges,status:abstractions.length?'BUILT_WITH_ABSTRACTION':'BUILT_NORMAL_FLOW',abstractions,diagnostics,entryId:start,exitId:exit,coverage:{profile:'experimental-scalar-ast-adapter-v1',scope:'selected-function normal flow',sourceExecution:false,implicitMainReturn:isMain?0:null,notImplemented:['STL profiles','RAII','exceptions','macros','templates','range-for','if-init','noreturn','production analyzer protocol']}};
}

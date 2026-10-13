#include <clang/AST/AST.h>
#include <clang/AST/RecursiveASTVisitor.h>
#include <clang/Analysis/CFG.h>
#include <clang/Basic/Diagnostic.h>
#include <clang/Frontend/FrontendActions.h>
#include <clang/Lex/Lexer.h>
#include <clang/Tooling/Tooling.h>
#include <llvm/Config/llvm-config.h>
#include <llvm/Support/JSON.h>
#include <llvm/Support/MemoryBuffer.h>
#include <llvm/Support/Path.h>
#include <llvm/Support/SHA256.h>
#include <llvm/Support/VirtualFileSystem.h>
#include <llvm/ADT/StringExtras.h>
#include <llvm/Support/FormatVariadic.h>
#include <llvm/Support/ConvertUTF.h>
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <functional>
#include <iostream>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

using namespace clang;
namespace J = llvm::json;
constexpr size_t WireLimit=1024*1024, SourceLimit=256*1024, OutputLimit=16*1024*1024;
const std::string VirtualFile="C:/__flowsketch__/input.cpp";
const std::string VirtualDir="C:/__flowsketch__";
const std::string AnalyzerVersion="flowsketch-native-0.1.0/clang-" LLVM_VERSION_STRING;
struct ModelError:std::runtime_error{std::string code;const Stmt *stmt;ModelError(std::string c,std::string m,const Stmt*s=nullptr):std::runtime_error(m),code(std::move(c)),stmt(s){}};
std::string normalizedPath(llvm::StringRef s){llvm::SmallString<512> p(s);llvm::sys::path::remove_dots(p,true);std::string out=p.str().str();std::replace(out.begin(),out.end(),'\\','/');return llvm::StringRef(out).lower();}
std::filesystem::path utf8Path(const std::string&s){return std::filesystem::path(std::u8string(reinterpret_cast<const char8_t*>(s.data()),s.size()));}
class BundleFileSystem:public llvm::vfs::ProxyFileSystem{
  llvm::IntrusiveRefCntPtr<llvm::vfs::FileSystem> real;std::vector<std::string> roots;
  bool lexicalAllowed(llvm::StringRef p)const{auto path=normalizedPath(p);for(auto&r:roots)if(path==r||path.starts_with(r+"/"))return true;return false;}
  bool allowed(llvm::StringRef p)const{if(!lexicalAllowed(p))return false;llvm::SmallString<512> resolved;if(real->getRealPath(p,resolved))return false;return lexicalAllowed(resolved);}
public:
  explicit BundleFileSystem(std::string root):ProxyFileSystem(llvm::vfs::getRealFileSystem()),real(llvm::vfs::getRealFileSystem()){
    roots.push_back(normalizedPath(root+"/include"));roots.push_back(normalizedPath(root+"/lib/clang/23/include"));
  }
  llvm::ErrorOr<llvm::vfs::Status> status(const llvm::Twine&p)override{auto s=p.str();if(!allowed(s))return std::make_error_code(std::errc::no_such_file_or_directory);return real->status(s);}
  llvm::ErrorOr<std::unique_ptr<llvm::vfs::File>> openFileForRead(const llvm::Twine&p)override{auto s=p.str();if(!lexicalAllowed(s))return std::make_error_code(std::errc::permission_denied);llvm::SmallString<512>resolved;if(auto ec=real->getRealPath(s,resolved))return ec;if(!lexicalAllowed(resolved))return std::make_error_code(std::errc::permission_denied);return real->openFileForRead(s);}
  llvm::vfs::directory_iterator dir_begin(const llvm::Twine&p,std::error_code&ec)override{auto s=p.str();if(!allowed(s)){ec=std::make_error_code(std::errc::permission_denied);return {};}return real->dir_begin(s,ec);}
  std::error_code getRealPath(const llvm::Twine&p,llvm::SmallVectorImpl<char>&out)override{auto s=p.str();if(!allowed(s))return std::make_error_code(std::errc::permission_denied);return real->getRealPath(s,out);}
  llvm::ErrorOr<std::string> getCurrentWorkingDirectory()const override{return VirtualDir;}
  std::error_code setCurrentWorkingDirectory(const llvm::Twine&p)override{return normalizedPath(p.str())==normalizedPath(VirtualDir)?std::error_code{}:std::make_error_code(std::errc::permission_denied);}
};
J::Object position(const std::string&source,size_t off){
  off=std::min(off,source.size());size_t line=1,last=0;for(size_t i=0;i<off;i++)if(source[i]=='\n'){line++;last=i+1;}
  size_t u16=1;for(size_t i=last;i<off;){unsigned char c=source[i];size_t n=c<128?1:(c&0xE0)==0xC0?2:(c&0xF0)==0xE0?3:4;u16+=n==4?2:1;i+=n;}
  return J::Object{{"offset",static_cast<int64_t>(off)},{"line",static_cast<int64_t>(line)},{"column",static_cast<int64_t>(off-last+1)},{"utf16Column",static_cast<int64_t>(u16)}};
}
struct SourceMapper{
  ASTContext&context;const std::string&source;
  J::Object range(SourceRange r,bool synthetic=false,bool allowMacro=false)const{
    auto&sm=context.getSourceManager();if(r.isInvalid())throw ModelError("SOURCE_MAPPING","Missing source range");
    if((r.getBegin().isMacroID()||r.getEnd().isMacroID())&&!allowMacro)throw ModelError("UNSUPPORTED_CONSTRUCT","Macro source mapping is outside this prototype");
    auto b=sm.getExpansionLoc(r.getBegin()),e=sm.getExpansionLoc(r.getEnd());
    if(!sm.isWrittenInMainFile(b)||!sm.isWrittenInMainFile(e))throw ModelError("SOURCE_MAPPING","Range is outside the captured source");
    auto end=Lexer::getLocForEndOfToken(e,0,sm,context.getLangOpts());
    size_t beginOff=sm.getFileOffset(b),endOff=sm.getFileOffset(end);if(endOff>source.size()||beginOff>endOff)throw ModelError("SOURCE_MAPPING","Invalid source offsets");
    return J::Object{{"file","input.cpp"},{"begin",position(source,beginOff)},{"end",position(source,endOff)},{"endExclusive",true},{"synthetic",synthetic},{"offsetEncoding","utf8-bytes"},{"columnEncoding","utf8-bytes"}};
  }
  std::string text(SourceRange r)const{
    auto rr=range(r);auto*b=rr.getObject("begin");auto*e=rr.getObject("end");return source.substr(*b->getInteger("offset"),*e->getInteger("offset")-*b->getInteger("offset"));
  }
  std::string text(const Stmt*s)const{return text(s->getSourceRange());}
};
bool allowedType(QualType t){
  if(t.isNull()||t.isVolatileQualified())return false;t=t.getCanonicalType();
  if(t->isBuiltinType()||t->isEnumeralType())return true;
  if(t->isPointerType()||t->isReferenceType())return allowedType(t->getPointeeType());
  if(auto*a=llvm::dyn_cast<ArrayType>(t.getTypePtr()))return allowedType(a->getElementType());
  return false;
}
std::string functionID(const FunctionDecl*d){std::string id=d->getQualifiedNameAsString()+"(";for(unsigned i=0;i<d->getNumParams();i++){if(i)id+=", ";id+=d->getParamDecl(i)->getType().getCanonicalType().getAsString();}if(d->isVariadic())id+=(d->getNumParams()?", ...":"...");return id+")";}
struct Validator{
  ASTContext&context;size_t visits=0;
  void expression(const Stmt*s,unsigned depth=0){
    if(!s)return;if(depth>128||++visits>10000)throw ModelError("GRAPH_LIMIT","Expression complexity exceeds prototype limit",s);
    if(s->getBeginLoc().isMacroID()||s->getEndLoc().isMacroID())throw ModelError("UNSUPPORTED_CONSTRUCT","Macros are not supported in this native prototype",s);
    if(auto*e=llvm::dyn_cast<Expr>(s))if(!allowedType(e->getType())&&!e->getType()->isFunctionType()&&!e->getType()->isFunctionPointerType())throw ModelError("UNSUPPORTED_TYPE","User objects and STL semantic profiles are not implemented",s);
    switch(s->getStmtClass()){
      case Stmt::ImplicitCastExprClass:case Stmt::ParenExprClass:case Stmt::DeclRefExprClass:
      case Stmt::IntegerLiteralClass:case Stmt::FloatingLiteralClass:case Stmt::CXXBoolLiteralExprClass:
      case Stmt::StringLiteralClass:case Stmt::CharacterLiteralClass:case Stmt::BinaryOperatorClass:
      case Stmt::CompoundAssignOperatorClass:case Stmt::UnaryOperatorClass:case Stmt::ConditionalOperatorClass:
      case Stmt::ArraySubscriptExprClass:case Stmt::CStyleCastExprClass:case Stmt::CXXStaticCastExprClass:
      case Stmt::ConstantExprClass:case Stmt::InitListExprClass:case Stmt::ImplicitValueInitExprClass:
      case Stmt::CXXNullPtrLiteralExprClass:break;
      case Stmt::UnaryExprOrTypeTraitExprClass:return; // unevaluated operand is not executed
      case Stmt::CallExprClass:{
        auto*call=llvm::cast<CallExpr>(s);auto*callee=call->getDirectCallee();
        if(!callee||llvm::isa<CXXMethodDecl>(callee)||!allowedType(callee->getReturnType()))throw ModelError("UNSUPPORTED_CONSTRUCT","Only resolved direct scalar function calls are implemented",s);
        for(auto*p:callee->parameters())if(!allowedType(p->getType()))throw ModelError("UNSUPPORTED_TYPE","Call signature uses an unsupported type",s);
        break;}
      default:throw ModelError("UNSUPPORTED_CONSTRUCT",std::string("Unsupported expression: ")+s->getStmtClassName(),s);
    }
    for(auto*c:s->children())expression(c,depth+1);
  }
  void statement(const Stmt*s,unsigned nesting=0){
    if(!s)return;if(nesting>24)throw ModelError("GRAPH_LIMIT","Control nesting exceeds 24",s);
    if(s->getBeginLoc().isMacroID()||s->getEndLoc().isMacroID())throw ModelError("UNSUPPORTED_CONSTRUCT","Macro control is not supported",s);
    if(auto*d=llvm::dyn_cast<DeclStmt>(s)){for(auto*decl:d->decls()){auto*v=llvm::dyn_cast<VarDecl>(decl);if(!v||!allowedType(v->getType())||v->isStaticLocal()||v->getTLSKind()!=VarDecl::TLS_None)throw ModelError("UNSUPPORTED_TYPE","Local declaration type/storage is outside prototype",s);expression(v->getInit());}return;}
    if(auto*b=llvm::dyn_cast<CompoundStmt>(s)){for(auto*c:b->body())statement(c,nesting);return;}
    if(auto*i=llvm::dyn_cast<IfStmt>(s)){if(i->isConstexpr()||i->getConditionVariable())throw ModelError("UNSUPPORTED_CONSTRUCT","if constexpr/declaration condition is outside prototype",s);statement(i->getInit(),nesting);expression(i->getCond());statement(i->getThen(),nesting+1);statement(i->getElse(),nesting+1);return;}
    if(auto*f=llvm::dyn_cast<ForStmt>(s)){if(f->getConditionVariable())throw ModelError("UNSUPPORTED_CONSTRUCT","For declaration condition is outside prototype",s);statement(f->getInit(),nesting);expression(f->getCond());expression(f->getInc());statement(f->getBody(),nesting+1);return;}
    if(auto*w=llvm::dyn_cast<WhileStmt>(s)){if(w->getConditionVariable())throw ModelError("UNSUPPORTED_CONSTRUCT","While declaration condition is outside prototype",s);expression(w->getCond());statement(w->getBody(),nesting+1);return;}
    if(auto*d=llvm::dyn_cast<DoStmt>(s)){statement(d->getBody(),nesting+1);expression(d->getCond());return;}
    if(auto*w=llvm::dyn_cast<SwitchStmt>(s)){if(w->getConditionVariable())throw ModelError("UNSUPPORTED_CONSTRUCT","Switch declaration condition is outside prototype",s);statement(w->getInit(),nesting);expression(w->getCond());statement(w->getBody(),nesting+1);return;}
    if(auto*c=llvm::dyn_cast<CaseStmt>(s)){if(c->getRHS())throw ModelError("UNSUPPORTED_CONSTRUCT","GNU case range is excluded",s);expression(c->getLHS());statement(c->getSubStmt(),nesting);return;}
    if(auto*d=llvm::dyn_cast<DefaultStmt>(s)){statement(d->getSubStmt(),nesting);return;}
    if(auto*r=llvm::dyn_cast<ReturnStmt>(s)){expression(r->getRetValue());return;}
    if(auto*a=llvm::dyn_cast<AttributedStmt>(s)){if(!llvm::isa<NullStmt>(a->getSubStmt()))throw ModelError("UNSUPPORTED_CONSTRUCT","Statement attributes are outside prototype",s);return;}
    if(llvm::isa<BreakStmt,ContinueStmt,NullStmt>(s))return;
    expression(s);
  }
  void function(const FunctionDecl*d){if(llvm::isa<CXXMethodDecl>(d)||d->getDescribedFunctionTemplate()||d->isTemplated())throw ModelError("UNSUPPORTED_CONSTRUCT","Methods and user templates are outside prototype");if(!allowedType(d->getReturnType()))throw ModelError("UNSUPPORTED_TYPE","Unsupported return type");for(auto*p:d->parameters())if(!allowedType(p->getType()))throw ModelError("UNSUPPORTED_TYPE","Unsupported parameter type");statement(d->getBody());}
};
struct Flow{std::string id;std::string role="normal";std::string hint="";};
struct LoopContext{std::optional<Flow> breakTarget,continueTarget;};
struct EdgeData{std::string id,source,target,label,role,hint,branch;};
struct GraphBuilder{
  ASTContext&context;const FunctionDecl*function;const std::string&source;SourceMapper mapper;
  J::Array nodes,abstractions,diagnostics;std::vector<EdgeData>edges;unsigned sequence=0;std::string entry,exit;bool abstracted=false;
  GraphBuilder(ASTContext&c,const FunctionDecl*f,const std::string&s):context(c),function(f),source(s),mapper{c,s}{}
  static std::string label(std::string t){while(!t.empty()&&(t.back()==';'||std::isspace(static_cast<unsigned char>(t.back()))))t.pop_back();return t;}
  std::string add(std::string kind,std::string text,const Stmt*origin,bool synthetic=false){
    if(nodes.size()>=500)throw ModelError("GRAPH_LIMIT","More than 500 graph nodes",origin);auto id="n"+std::to_string(++sequence);
    auto r=mapper.range(origin->getSourceRange(),synthetic);r["originKind"]=origin->getStmtClassName();
    J::Object n{{"id",id},{"kind",std::move(kind)},{"label",std::move(text)},{"sourceRange",std::move(r)},{"astKind",origin->getStmtClassName()}};
    n["originalText"]=synthetic?J::Value(nullptr):J::Value(mapper.text(origin));nodes.push_back(std::move(n));return id;
  }
  void connect(std::string from,Flow to,std::string text="",std::string role="",std::string branch=""){
    if(edges.size()>=1000)throw ModelError("GRAPH_LIMIT","More than 1000 graph edges");
    if(role.empty())role=to.role;std::string hint=(to.hint=="back"||to.role=="back"||role=="back")?"back":"";
    edges.push_back({"e"+std::to_string(edges.size()+1),std::move(from),to.id,std::move(text),std::move(role),std::move(hint),std::move(branch)});
  }
  struct Condition{std::string entry;std::function<void(Flow,Flow)>attach;};
  Condition condition(const Expr*expr){
    expr=expr->IgnoreParenImpCasts();
    if(auto*u=llvm::dyn_cast<UnaryOperator>(expr);u&&u->getOpcode()==UO_LNot){auto q=condition(u->getSubExpr());return {q.entry,[q](Flow yes,Flow no){q.attach(no,yes);}};}
    if(auto*b=llvm::dyn_cast<BinaryOperator>(expr);b&&(b->getOpcode()==BO_LAnd||b->getOpcode()==BO_LOr)){
      auto l=condition(b->getLHS()),r=condition(b->getRHS());bool andOp=b->getOpcode()==BO_LAnd;
      return {l.entry,[l,r,andOp](Flow yes,Flow no){if(andOp){l.attach({r.entry},no);r.attach(yes,no);}else{l.attach(yes,{r.entry});r.attach(yes,no);}}};
    }
    recordCalls(expr);if(containsNoReturn(expr))throw ModelError("UNSUPPORTED_CONSTRUCT","Noreturn condition is outside prototype",expr);
    auto id=add("decision",label(mapper.text(expr)),expr);
    return {id,[this,id](Flow yes,Flow no){connect(id,yes,"Да",yes.role=="back"?"back":"true","true");connect(id,no,"Нет",no.role=="back"?"back":"false","false");}};
  }
  void recordCalls(const Stmt*s){
    if(!s)return;if(llvm::isa<UnaryExprOrTypeTraitExpr>(s))return;
    if(auto*c=llvm::dyn_cast<CallExpr>(s)){
      auto*d=c->getDirectCallee();abstracted=true;J::Object a{{"kind","opaque-call"},{"originalText",mapper.text(c)},{"sourceRange",mapper.range(c->getSourceRange())},{"callee",d->getQualifiedNameAsString()},{"signature",functionID(d)},{"noReturn",d->isNoReturn()},{"definitionAvailable",d->doesThisDeclarationHaveABody()},{"omitted","callee body, exception and lifetime paths"}};
      abstractions.push_back(std::move(a));
    }
    for(auto*c:s->children())recordCalls(c);
  }
  const CallExpr* topCall(const Stmt*s){auto*e=llvm::dyn_cast<Expr>(s);if(auto*r=llvm::dyn_cast<ReturnStmt>(s))e=r->getRetValue();return e?llvm::dyn_cast<CallExpr>(e->IgnoreParenImpCasts()):nullptr;}
  bool containsNoReturn(const Stmt*s){if(!s||llvm::isa<UnaryExprOrTypeTraitExpr>(s))return false;if(auto*c=llvm::dyn_cast<CallExpr>(s);c&&c->getDirectCallee()->isNoReturn())return true;for(auto*c:s->children())if(containsNoReturn(c))return true;return false;}
  std::string simple(const Stmt*s,Flow next,bool returning=false){
    recordCalls(s);auto*call=topCall(s);
    if(containsNoReturn(s)&&(!call||!call->getDirectCallee()->isNoReturn()))throw ModelError("UNSUPPORTED_CONSTRUCT","Nested/conditional noreturn effect requires a richer model",s);
    auto id=add(call?"call":"process",label(mapper.text(s)),s);
    if(call&&call->getDirectCallee()->isNoReturn()){
      auto*d=call->getDirectCallee();bool libraryExit=d->getNameAsString()=="exit"&&context.getSourceManager().isInSystemHeader(d->getLocation());
      auto terminal=add("terminator",libraryExit?"Завершение программы":"Невозврат из вызова",s,true);connect(id,{terminal},"","nonreturn");return id;
    }
    connect(id,next,"",returning?"return":"");return id;
  }
  std::string list(std::vector<const Stmt*>items,Flow next,LoopContext ctx){for(auto it=items.rbegin();it!=items.rend();++it){auto id=compile(*it,next,ctx);if(id!=next.id)next={id};}return next.id;}
  std::string compile(const Stmt*s,Flow next,LoopContext ctx){
    if(!s||llvm::isa<NullStmt>(s))return next.id;
    if(auto*b=llvm::dyn_cast<CompoundStmt>(s))return list(std::vector<const Stmt*>(b->body_begin(),b->body_end()),next,ctx);
    if(llvm::isa<AttributedStmt>(s))return next.id;
    if(llvm::isa<ReturnStmt>(s))return simple(s,{exit},true);
    if(llvm::isa<BreakStmt,ContinueStmt>(s)){bool breaking=llvm::isa<BreakStmt>(s);auto target=breaking?ctx.breakTarget:ctx.continueTarget;if(!target)throw ModelError("UNSUPPORTED_CONSTRUCT","Jump has no enclosing target",s);auto id=add("process",breaking?"break":"continue",s);connect(id,*target,"",breaking?"break":"continue");return id;}
    if(auto*i=llvm::dyn_cast<IfStmt>(s)){
      auto q=condition(i->getCond());auto yes=compile(i->getThen(),next,ctx);auto no=i->getElse()?Flow{compile(i->getElse(),next,ctx)}:next;
      auto alias=[next](Flow f){if(f.id==next.id&&(next.role=="back"||next.hint=="back"))f.hint="back";return f;};
      q.attach(alias({yes}),alias(no));return i->getInit()?compile(i->getInit(),{q.entry},ctx):q.entry;
    }
    if(auto*f=llvm::dyn_cast<ForStmt>(s)){
      std::optional<Condition>q;if(f->getCond())q=condition(f->getCond());auto header=q?q->entry:add("connector","",s,true);
      auto inc=f->getInc()?simple(f->getInc(),{header,"back"}):header;auto loopCtx=ctx;loopCtx.breakTarget=next;loopCtx.continueTarget=Flow{inc,"normal",f->getInc()?"":"back"};
      auto body=compile(f->getBody(),{inc,f->getInc()?"normal":"back"},loopCtx);Flow target{body,"normal",body==header?"back":""};
      if(q)q->attach(target,next);else connect(header,target);return f->getInit()?compile(f->getInit(),{header},ctx):header;
    }
    if(auto*w=llvm::dyn_cast<WhileStmt>(s)){auto q=condition(w->getCond());auto c=ctx;c.breakTarget=next;c.continueTarget=Flow{q.entry,"normal","back"};auto body=compile(w->getBody(),{q.entry,"back"},c);q.attach({body,"normal",body==q.entry?"back":""},next);return q.entry;}
    if(auto*d=llvm::dyn_cast<DoStmt>(s)){auto q=condition(d->getCond());auto c=ctx;c.breakTarget=next;c.continueTarget=Flow{q.entry};auto body=compile(d->getBody(),{q.entry},c);q.attach({body,"back"},next);return body;}
    if(auto*w=llvm::dyn_cast<SwitchStmt>(s)){
      auto*b=llvm::dyn_cast<CompoundStmt>(w->getBody());if(!b)throw ModelError("UNSUPPORTED_CONSTRUCT","Switch body must be a block in prototype",s);
      struct Group{std::vector<std::pair<std::string,std::string>>labels;std::vector<const Stmt*>body;std::string entry;};std::vector<Group>groups;
      for(auto*item:b->body()){
        if(llvm::isa<SwitchCase>(item)){groups.emplace_back();auto&g=groups.back();const Stmt*current=item;
          while(auto*c=llvm::dyn_cast<SwitchCase>(current)){if(auto*cs=llvm::dyn_cast<CaseStmt>(c)){g.labels.emplace_back("case "+mapper.text(cs->getLHS()),"case");current=cs->getSubStmt();}else{g.labels.emplace_back("Иначе","default");current=llvm::cast<DefaultStmt>(c)->getSubStmt();}}
          if(current)g.body.push_back(current);
        }else{if(groups.empty())throw ModelError("UNSUPPORTED_CONSTRUCT","Code before first case is outside prototype",item);groups.back().body.push_back(item);}
      }
      auto following=next;auto c=ctx;c.breakTarget=next;for(auto it=groups.rbegin();it!=groups.rend();++it){it->entry=list(it->body,following,c);following={it->entry,"fallthrough"};}
      recordCalls(w->getCond());if(containsNoReturn(w->getCond()))throw ModelError("UNSUPPORTED_CONSTRUCT","Noreturn switch condition is outside prototype",w->getCond());
      auto id=add("decision",label(mapper.text(w->getCond())),w->getCond());bool hasDefault=false;
      for(auto&g:groups)for(auto&[label,role]:g.labels){connect(id,{g.entry},label,role);hasDefault|=role=="default";}
      if(!hasDefault)connect(id,next,"Нет совпадения","default");return w->getInit()?compile(w->getInit(),{id},ctx):id;
    }
    return simple(s,next);
  }
  J::Object build(){
    Validator{context}.function(function);bool main=function->isMain();auto*body=function->getBody();
    std::function<bool(const Stmt*)>hasReturn=[&](const Stmt*s){if(!s)return false;if(llvm::isa<ReturnStmt>(s))return true;for(auto*c:s->children())if(hasReturn(c))return true;return false;};
    exit=add("terminator",main&&!hasReturn(body)?"Конец · return 0":"Конец",body,true);entry=add("terminator","Начало",body,true);auto first=compile(body,{exit},{});connect(entry,{first});
    std::set<std::string>reachable;std::vector<std::string>queue{entry};while(!queue.empty()){auto id=queue.back();queue.pop_back();if(!reachable.insert(id).second)continue;for(auto&e:edges)if(e.source==id)queue.push_back(e.target);}
    for(auto&v:nodes){auto*o=v.getAsObject();auto id=o->getString("id")->str();(*o)["reachable"]=reachable.contains(id);}
    if(!main&&!function->getReturnType()->isVoidType())for(auto&e:edges)if(e.target==exit&&e.role!="return"&&reachable.contains(e.source))throw ModelError("MISSING_RETURN","Non-void normal flow reaches function end");
    J::Array outEdges;for(auto&e:edges){J::Object obj{{"id",e.id},{"source",e.source},{"target",e.target},{"label",e.label},{"role",e.role}};if(!e.hint.empty())obj["layoutHint"]=e.hint;if(!e.branch.empty())obj["conditionBranch"]=e.branch;outEdges.push_back(std::move(obj));}
    auto status=abstracted?"BUILT_WITH_ABSTRACTION":"BUILT_NORMAL_FLOW";
    return J::Object{{"id",functionID(function)},{"title",function->getQualifiedNameAsString()},{"nodes",std::move(nodes)},{"edges",std::move(outEdges)},{"status",status},{"entryId",entry},{"exitId",exit},{"abstractions",std::move(abstractions)},{"diagnostics",std::move(diagnostics)},{"coverage",J::Object{{"scope","selected-function normal flow"},{"sourceExecution",false},{"nativeLibTooling",true},{"implicitActionsAndExceptions",false},{"stlSemanticProfiles",false}}}};
  }
};
struct RunState{std::string source,operation,functionId;J::Object response;J::Array diagnostics;bool compilerError=false;};
class CapturedDiagnostics:public DiagnosticConsumer{
  RunState&state;
public:explicit CapturedDiagnostics(RunState&s):state(s){}
  void HandleDiagnostic(DiagnosticsEngine::Level level,const Diagnostic&info)override{
    DiagnosticConsumer::HandleDiagnostic(level,info);if(level>=DiagnosticsEngine::Error)state.compilerError=true;if(state.diagnostics.size()>=100)return;
    llvm::SmallString<512>msg;info.FormatDiagnostic(msg);J::Object item{{"code",level>=DiagnosticsEngine::Error?"PARSE_ERROR":"CLANG_WARNING"},{"message",msg.str().str()},{"severity",level>=DiagnosticsEngine::Error?"error":"warning"}};
    if(info.hasSourceManager()&&info.getLocation().isValid()){auto&sm=info.getSourceManager();auto loc=sm.getExpansionLoc(info.getLocation());if(sm.isWrittenInMainFile(loc)){size_t off=sm.getFileOffset(loc);item["sourceRange"]=J::Object{{"file","input.cpp"},{"begin",position(state.source,off)},{"end",position(state.source,std::min(off+1,state.source.size()))},{"endExclusive",true},{"offsetEncoding","utf8-bytes"},{"columnEncoding","utf8-bytes"}};}}
    state.diagnostics.push_back(std::move(item));
  }
};
class FunctionCollector:public RecursiveASTVisitor<FunctionCollector>{
public:ASTContext&context;std::vector<FunctionDecl*>functions;bool dynamicGlobal=false;
  explicit FunctionCollector(ASTContext&c):context(c){}
  bool VisitFunctionDecl(FunctionDecl*d){auto&sm=context.getSourceManager();if(d->doesThisDeclarationHaveABody()&&sm.isWrittenInMainFile(sm.getExpansionLoc(d->getBeginLoc())))functions.push_back(d);return functions.size()<=128;}
  bool VisitVarDecl(VarDecl*d){auto&sm=context.getSourceManager();if(d->hasGlobalStorage()&&!d->isStaticLocal()&&sm.isWrittenInMainFile(d->getBeginLoc())&&(!allowedType(d->getType())||(d->hasInit()&&!d->getInit()->isConstantInitializer(context,false))))dynamicGlobal=true;return true;}
};
class Consumer:public ASTConsumer{
  RunState&state;
public:explicit Consumer(RunState&s):state(s){}
  void HandleTranslationUnit(ASTContext&context)override{
    if(state.compilerError)return;FunctionCollector collector(context);collector.TraverseDecl(context.getTranslationUnitDecl());SourceMapper mapper{context,state.source};J::Array functions;FunctionDecl*chosen=nullptr;
    if(collector.functions.size()>128){state.response["status"]="UNSUPPORTED";state.diagnostics.push_back(J::Object{{"code","GRAPH_LIMIT"},{"message","More than 128 source functions"}});return;}
    for(auto*d:collector.functions){bool supported=true;std::string reason;try{Validator{context}.function(d);if(collector.dynamicGlobal)throw ModelError("UNSUPPORTED_CONSTRUCT","Dynamic source global initialization is outside prototype");}catch(const ModelError&e){supported=false;reason=e.what();}
      auto id=functionID(d);J::Object f{{"id",id},{"name",d->getQualifiedNameAsString()},{"signature",d->getReturnType().getAsString()+" "+id},{"sourceRange",mapper.range(d->getSourceRange(),false,true)},{"supported",supported}};if(!reason.empty())f["unsupportedReason"]=reason;functions.push_back(std::move(f));
      if(!state.functionId.empty()&&id==state.functionId)chosen=d;
      if(state.functionId.empty()&&supported&&(!chosen||d->isMain()))chosen=d;
    }
    state.response["functions"]=std::move(functions);
    if(state.operation=="discover"){state.response["status"]="DISCOVERED";return;}
    if(!chosen&&!collector.functions.empty()&&state.functionId.empty())chosen=collector.functions.front();
    if(!chosen){state.response["status"]="INPUT_ERROR";state.diagnostics.push_back(J::Object{{"code","FUNCTION_NOT_FOUND"},{"message","Choose a current source function"}});return;}
    state.response["functionId"]=functionID(chosen);
    try{
      if(collector.dynamicGlobal)throw ModelError("UNSUPPORTED_CONSTRUCT","Dynamic source global initialization is outside prototype");
      auto graph=GraphBuilder(context,chosen,state.source).build();
      CFG::BuildOptions options;options.AddEHEdges=false;options.AddImplicitDtors=false;options.PruneTriviallyFalseEdges=false;
      auto cfg=CFG::buildCFG(chosen,chosen->getBody(),&context,options);if(!cfg)throw ModelError("CFG_FAILED","Clang CFG could not be constructed");
      size_t cfgEdges=0;for(auto*b:*cfg)cfgEdges+=b->succ_size();
      state.response["cfgSummary"]=J::Object{{"blocks",static_cast<int64_t>(cfg->size())},{"edges",static_cast<int64_t>(cfgEdges)},{"sourceLevel",true},{"exceptionEdges",false},{"implicitDestructors",false},{"pruneTriviallyFalseEdges",false}};
      state.response["status"]=graph.getString("status")->str();state.response["graph"]=std::move(graph);
    }catch(const ModelError&e){state.response["status"]="UNSUPPORTED";J::Object diag{{"code",e.code},{"message",std::string(e.what())},{"severity","error"}};if(e.stmt)try{diag["sourceRange"]=mapper.range(e.stmt->getSourceRange(),false,true);}catch(...){ }state.diagnostics.push_back(std::move(diag));}
  }
};
class Action:public ASTFrontendAction{
  RunState&state;
public:explicit Action(RunState&s):state(s){}
  std::unique_ptr<ASTConsumer>CreateASTConsumer(CompilerInstance&,llvm::StringRef)override{return std::make_unique<Consumer>(state);}
};
std::string utf8(llvm::ArrayRef<llvm::UTF16>input){std::string output;if(!llvm::convertUTF16ToUTF8String(input,output))return {};return output;}
int application(std::vector<std::string>args){
#ifdef _WIN32
  _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
#endif
  auto start=std::chrono::steady_clock::now();std::string toolchain;
  for(size_t i=1;i<args.size();i++){if(args[i]=="--version"){llvm::outs()<<AnalyzerVersion<<"\n";return 0;}if(args[i]=="--toolchain-root"&&i+1<args.size()){toolchain=args[++i];continue;}llvm::errs()<<"Unknown trusted configuration argument\n";return 2;}
  std::string input;char buffer[8192];while(std::cin){std::cin.read(buffer,sizeof(buffer));input.append(buffer,static_cast<size_t>(std::cin.gcount()));if(input.size()>WireLimit){llvm::outs()<<R"({"protocolVersion":1,"requestId":"","sourceRevision":0,"sourceDigest":"","contextDigest":"","analyzerVersion":"flowsketch-native-0.1.0","status":"FAILURE","functions":[],"diagnostics":[{"code":"SOURCE_LIMIT","message":"JSON wire input exceeds 1MiB"}]})";return 1;}}
  RunState state;state.response=J::Object{{"protocolVersion",1},{"requestId",""},{"sourceRevision",0},{"sourceDigest",""},{"contextDigest",""},{"analyzerVersion",AnalyzerVersion},{"status","FAILURE"},{"functions",J::Array{}},{"coverage",J::Object{{"profile","native-scalar-cpp17-vertical-slice"},{"sourceExecution",false},{"full50CaseAcceptance",false},{"normalFlowOnly",true},{"implicitObjectActionsAndExceptions",false}}}};
  auto fail=[&](std::string code,std::string msg){state.response["status"]="FAILURE";state.diagnostics.push_back(J::Object{{"code",std::move(code)},{"message",std::move(msg)},{"severity","error"}});};
  auto parsed=J::parse(input);
  if(!parsed){fail("PROTOCOL_ERROR",llvm::toString(parsed.takeError()));}
  else if(auto*r=parsed->getAsObject()){
    for(auto key:{"requestId","sourceDigest","contextDigest"})if(auto s=r->getString(key))state.response[key]=s->str();if(auto v=r->getInteger("sourceRevision"))state.response["sourceRevision"]=*v;
    auto source=r->getString("source"); auto revision=r->getInteger("sourceRevision"); auto version=r->getInteger("protocolVersion");auto requestId=r->getString("requestId"),digest=r->getString("sourceDigest"),contextDigest=r->getString("contextDigest");
    state.operation=r->getString("operation").value_or("analyze").str();state.functionId=r->getString("functionId").value_or("").str();
    if(!version||*version!=1||!source||!revision||*revision<0||!requestId||requestId->empty()||requestId->size()>256||!digest||!contextDigest||contextDigest->size()>256||(state.operation!="analyze"&&state.operation!="discover"))fail("PROTOCOL_ERROR","Invalid protocol v1 fields");
    else if(source->size()>SourceLimit||std::count(source->begin(),source->end(),'\n')+(!source->empty()&&source->back()!='\n')>5000){fail("SOURCE_LIMIT","Source exceeds 256KiB or 5000 lines");state.response["status"]="INPUT_ERROR";}
    else{
      state.source=source->str();auto hash=llvm::SHA256::hash(llvm::ArrayRef<uint8_t>(reinterpret_cast<const uint8_t*>(state.source.data()),state.source.size()));auto actual=llvm::toHex(hash,true);
      if(actual!=*digest)fail("DIGEST_MISMATCH","sourceDigest does not match captured UTF8 source");
      else if(toolchain.empty()||!std::filesystem::is_regular_file(utf8Path(toolchain+"/include/c++/v1/iostream")))fail("TOOLCHAIN_CONFIG","Trusted bundled toolchain root is missing");
      else{
        llvm::IntrusiveRefCntPtr<llvm::vfs::FileSystem>guard(new BundleFileSystem(toolchain));llvm::IntrusiveRefCntPtr<llvm::vfs::OverlayFileSystem>overlay(new llvm::vfs::OverlayFileSystem(guard));llvm::IntrusiveRefCntPtr<llvm::vfs::InMemoryFileSystem>memory(new llvm::vfs::InMemoryFileSystem);
        memory->addFile(VirtualFile,0,llvm::MemoryBuffer::getMemBufferCopy(state.source));memory->setCurrentWorkingDirectory(VirtualDir);overlay->pushOverlay(memory);
        FileSystemOptions fsOptions;llvm::IntrusiveRefCntPtr<FileManager> files(new FileManager(fsOptions,overlay));
        std::vector<std::string>command{toolchain+"/bin/clang++.exe","--no-default-config","--target=x86_64-w64-windows-gnu","--sysroot="+toolchain,"-resource-dir="+toolchain+"/lib/clang/23","-nostdinc","-nostdinc++","-isystem",toolchain+"/include/c++/v1","-isystem",toolchain+"/lib/clang/23/include","-isystem",toolchain+"/include","-std=c++17","-pedantic-errors","-Werror=return-type","-ferror-limit=20","-fno-color-diagnostics","-fno-modules","-fno-implicit-modules","-fno-implicit-module-maps","-fsyntax-only",VirtualFile};
        CapturedDiagnostics diagnostics(state);tooling::ToolInvocation invocation(command,std::make_unique<Action>(state),files.get());invocation.setDiagnosticConsumer(&diagnostics);bool ok=invocation.run();
        if(!ok||state.compilerError){state.response["status"]="INPUT_ERROR";state.response.erase("graph");}
      }
    }
  }else fail("PROTOCOL_ERROR","Expected one JSON object");
  state.response["diagnostics"]=std::move(state.diagnostics);state.response["elapsedMs"]=static_cast<int64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-start).count());
  std::string output=llvm::formatv("{0}",J::Value(J::Object(state.response))).str();
  if(output.size()>OutputLimit){state.response.erase("graph");state.response["functions"]=J::Array{};state.response["status"]="FAILURE";state.response["diagnostics"]=J::Array{J::Object{{"code","GRAPH_LIMIT"},{"message","Output exceeds16MiB"}}};output=llvm::formatv("{0}",J::Value(std::move(state.response))).str();}
  llvm::outs()<<output<<"\n";return 0;
}
#ifdef _WIN32
int wmain(int argc,wchar_t**argv){std::vector<std::string>args;for(int i=0;i<argc;i++)args.push_back(utf8(llvm::ArrayRef<llvm::UTF16>(reinterpret_cast<llvm::UTF16*>(argv[i]),wcslen(argv[i]))));return application(std::move(args));}
#else
int main(int argc,char**argv){return application(std::vector<std::string>(argv,argv+argc));}
#endif

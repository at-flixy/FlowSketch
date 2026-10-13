import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {astToGraph,UnsupportedAstError} from './ast-to-graph.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export function getToolchain() {
  const manifest=JSON.parse(fs.readFileSync(path.join(here,'toolchain.json'),'utf8').replace(/^\uFEFF/,''));
  const actualHash=crypto.createHash('sha256').update(fs.readFileSync(manifest.executable)).digest('hex');
  if(actualHash!==manifest.executableSha256)throw new Error('Pinned compiler executable SHA256 mismatch');
  return manifest;
}
export function cleanEnvironment(root,tempDirectory) {
  const windows=process.env.SystemRoot??process.env.SYSTEMROOT??'C:\\Windows';
  return {SystemRoot:windows,windir:windows,TEMP:tempDirectory,TMP:tempDirectory,PATH:path.join(root,'bin')+';'+path.join(windows,'System32')};
}
export function compilerArguments(root) {
  return ['--no-default-config','--target=x86_64-w64-windows-gnu','--sysroot='+root,'-resource-dir='+path.join(root,'lib','clang','23'),'-nostdinc','-nostdinc++','-isystem',path.join(root,'include','c++','v1'),'-isystem',path.join(root,'lib','clang','23','include'),'-isystem',path.join(root,'include'),'-std=c++17','-pedantic-errors','-Werror=return-type','-fno-color-diagnostics','-fdiagnostics-absolute-paths'];
}
export function runCompiler(args,{directory,manifest=getToolchain()}={}) {
  const environment=cleanEnvironment(manifest.toolchainRoot,directory??here);
  const start=performance.now();
  const result=spawnSync(manifest.executable,args,{cwd:directory??here,env:environment,encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024,windowsHide:true});
  return {exitCode:result.status,signal:result.signal,elapsedMs:Math.round(performance.now()-start),stdout:result.stdout??'',stderr:result.stderr??'',error:result.error?.message??null,arguments:args,environmentKeys:Object.keys(environment),shell:false};
}
export function analyzeCpp({source,functionName,id=functionName,fileLabel=id+'.cpp',outputDirectory,skipCfg=false,skipGraph=false,verbose=false}={}) {
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>256*1024)throw new TypeError('Expected source string <=256 KiB');
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName))throw new TypeError('Spike only supports one simple function name');
  const directory=path.resolve(outputDirectory??path.join(here,'results',id));fs.mkdirSync(directory,{recursive:true});
  const sourcePath=path.join(directory,id+'.cpp');fs.writeFileSync(sourcePath,source,'utf8');
  const manifest=getToolchain(),base=compilerArguments(manifest.toolchainRoot);
  const syntax=runCompiler([...base,'-fsyntax-only',...(verbose?['-v']:[]),sourcePath],{directory,manifest});
  fs.writeFileSync(path.join(directory,'syntax.stderr.txt'),syntax.stderr);fs.writeFileSync(path.join(directory,'syntax.stdout.txt'),syntax.stdout);
  const result={id,functionName,sourcePath,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),syntax,ast:null,cfg:null,graph:null,adapterError:null};
  if(syntax.exitCode!==0||syntax.error){result.status='INPUT_ERROR';return result;}
  const astResult=runCompiler([...base,'-fsyntax-only','-Xclang','-ast-dump=json','-Xclang','-ast-dump-filter='+functionName,sourcePath],{directory,manifest});
  fs.writeFileSync(path.join(directory,'ast.json'),astResult.stdout);fs.writeFileSync(path.join(directory,'ast.stderr.txt'),astResult.stderr);result.astProcess=astResult;
  if(astResult.exitCode!==0||astResult.error){result.status='FAILURE';return result;}
  try {result.ast=JSON.parse(astResult.stdout);}catch(error){result.status='FAILURE';result.adapterError='Filtered AST is not one JSON object: '+error.message;return result;}
  if(result.ast.kind!=='FunctionDecl'||result.ast.name!==functionName){result.status='UNSUPPORTED';result.adapterError='Selected filtered AST is not the exact requested function';return result;}
  if(!skipCfg){
    const parameters=(result.ast.inner??[]).filter(n=>n.kind==='ParmVarDecl').map(n=>n.type.qualType==='bool'?'_Bool':n.type.qualType);
    const signature=functionName+'('+parameters.join(', ')+')';
    const cfgResult=runCompiler([...base,'--analyze','-Xclang','-analyzer-checker=debug.DumpCFG','-Xclang','-analyze-function='+signature,'-o',path.join(directory,'analysis.plist'),sourcePath],{directory,manifest});
    fs.writeFileSync(path.join(directory,'cfg.txt'),cfgResult.stderr);fs.writeFileSync(path.join(directory,'cfg.stdout.txt'),cfgResult.stdout);result.cfgProcess=cfgResult;result.cfg=cfgResult.stderr;
    if(cfgResult.exitCode!==0||cfgResult.error||!cfgResult.stderr.includes('(ENTRY)')){result.status='FAILURE';return result;}
  }
  if(skipGraph){result.status='PARSED_ONLY';return result;}
  try {result.graph=astToGraph(result.ast,{source,file:fileLabel,id,title:functionName==='sumOdd'?'Сумма нечетных чисел':functionName});result.status=result.graph.status;fs.writeFileSync(path.join(directory,'graph.json'),JSON.stringify(result.graph,null,2));}
  catch(error){if(!(error instanceof UnsupportedAstError))throw error;result.status='UNSUPPORTED';result.adapterError={message:error.message,astKind:error.astKind};}
  return result;
}

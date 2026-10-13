import {readFile,readdir,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'docs/distribution-notices');await mkdir(out,{recursive:true});
const inventory=[];
async function collect(directory,name,license,repository){
  const dest=resolve(out,name.replaceAll('/','__'));await mkdir(dest,{recursive:true});
  const files=(await readdir(directory,{withFileTypes:true})).filter(e=>e.isFile()&&/^(license|licence|copying|notice|copyright)(\.|-|$)/i.test(e.name));
  for(const file of files)await copyFile(resolve(directory,file.name),resolve(dest,file.name));
  inventory.push({name,license,repository,licenseFiles:files.map(e=>e.name)});
}
const lock=JSON.parse(await readFile(resolve(root,'package-lock.json'),'utf8'));
const seen=new Set();
async function npmPackage(name,from=''){
  let key=(from?from+'/node_modules/':'node_modules/')+name;
  while(!lock.packages[key]){if(!from){throw new Error('Package not found: '+name);}from=from.includes('/node_modules/')?from.slice(0,from.lastIndexOf('/node_modules/')):'';key=(from?from+'/node_modules/':'node_modules/')+name;}
  if(seen.has(key))return;seen.add(key);
  const directory=resolve(root,key);const pkg=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));
  await collect(directory,'npm-'+pkg.name+'-'+pkg.version,pkg.license,pkg.repository);
  for(const dependency of Object.keys(pkg.dependencies||{}))await npmPackage(dependency,key);
}
for(const name of ['react','react-dom','monaco-editor','lucide-react','@tauri-apps/api','@fontsource/ibm-plex-sans','@fontsource/jetbrains-mono','elkjs','fontkit'])await npmPackage(name);
const cargo=JSON.parse((await readFile(resolve(root,'spikes/tauri/cargo-metadata.json'),'utf8')).replace(/^\uFEFF/,''));
for(const pkg of cargo.packages.filter(p=>p.source&&p.source.startsWith('registry'))){await collect(dirname(pkg.manifest_path),'rust-'+pkg.name+'-'+pkg.version,pkg.license,pkg.repository);}
await writeFile(resolve(out,'inventory.json'),JSON.stringify({scope:'Embedded frontend dependency closure; Cargo.lock registry packages including build and non-Windows target notices (superset). Release SBOM remains separate.',packages:inventory},null,2));
console.log(`Copied ${inventory.length} dependency notice sets.`);

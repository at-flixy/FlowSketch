// Diagnostic only: execute the packaged ELK classic worker at the real App origin.
import { writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:4447';
async function call(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok || data.value?.error) throw new Error(JSON.stringify(data)); return data.value;
}
const session = (await call('/session', { capabilities: { alwaysMatch: { 'wdio:tauriServiceOptions': { windowLabel: 'main' } } } })).sessionId;
try {
  const script = `
    if(location.origin!=='http://tauri.localhost')throw new Error('App origin required');
    window.__elkProbe={url:location.href,events:[],headers:null};
    addEventListener('securitypolicyviolation',e=>window.__elkProbe.events.push({type:'CSP',directive:e.violatedDirective,blocked:e.blockedURI}));
    const url='/assets/elk-worker.min-r_yRvuMO.js';
    fetch(url).then(async r=>window.__elkProbe.headers={status:r.status,type:r.headers.get('content-type'),csp:r.headers.get('content-security-policy'),prefix:(await r.text()).slice(0,80)}).catch(e=>window.__elkProbe.events.push({type:'FETCH_ERROR',message:e.message}));
    const worker=new Worker(url);window.__elkProbeWorker=worker;
    worker.onerror=e=>window.__elkProbe.events.push({type:'ERROR',message:e.message,filename:e.filename,line:e.lineno,column:e.colno});
    worker.onmessageerror=e=>window.__elkProbe.events.push({type:'MESSAGE_ERROR'});
    worker.onmessage=e=>{window.__elkProbe.events.push({type:'MESSAGE',data:e.data});if(e.data.id===0)worker.postMessage({id:1,cmd:'layout',graph:{id:'probe',layoutOptions:{'elk.algorithm':'layered'},children:[{id:'a',width:100,height:40}]},layoutOptions:{},options:{}});};
    worker.postMessage({id:0,cmd:'register',algorithms:['layered']});return true;
  `;
  await call(`/session/${session}/execute/sync`, { script, args: [] });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const result = await call(`/session/${session}/execute/sync`, { script: 'return window.__elkProbe;', args: [] });
  await writeFile(new URL('../../spikes/tauri/diagram-browser/app-worker-probe.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await call(`/session/${session}/execute/sync`, { script: 'window.__elkProbeWorker?.terminate();return true;', args: [] }).catch(() => {});
  await call(`/session/${session}`, undefined, 'DELETE').catch(() => {});
}

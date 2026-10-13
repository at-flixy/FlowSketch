import { parentPort } from 'node:worker_threads';
import ELK from 'elkjs/lib/elk.bundled.js';
const elk = new ELK();
parentPort.once('message', async graph => {
  try { parentPort.postMessage({ok:true,graph:await elk.layout(graph)}); }
  catch(error) { parentPort.postMessage({ok:false,error:String(error.stack||error)}); }
});

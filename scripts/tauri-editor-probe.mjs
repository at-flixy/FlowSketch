const base='http://127.0.0.1:4447';
async function call(path,body){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(d.value?.error)throw new Error(JSON.stringify(d));return d.value;}
const {sessionId}=await call('/session',{capabilities:{}});
try {
console.log(JSON.stringify(await call(`/session/${sessionId}/execute/sync`,{script:'const e=document.querySelector(".monaco-editor [role=textbox]");e.focus();const c=e.editContext;const start=c.selectionStart,end=c.selectionEnd;c.updateText(start,end," ");c.updateSelection(start+1,start+1);c.dispatchEvent(new TextUpdateEvent("textupdate",{updateRangeStart:start,updateRangeEnd:end,text:" ",selectionStart:start+1,selectionEnd:start+1}));return {start,end,textLength:c.text.length,active:document.activeElement.className};',args:[]}),null,2));
await new Promise(r=>setTimeout(r,200));console.log(await call(`/session/${sessionId}/execute/sync`,{script:'return {disabled:document.querySelector(".top-actions button:nth-child(2)").disabled,note:document.querySelector(".source-note").textContent};',args:[]}));
}
finally{await fetch(base+`/session/${sessionId}`,{method:'DELETE'});}

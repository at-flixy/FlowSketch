// Smoke-test the ordinary shipped EXE. CDP is enabled only by a launch environment
// variable; this app build contains neither WebDriver nor fixture file selectors.
const {createRequire}=require('node:module');
const {resolve}=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const root=resolve(__dirname,'..');
const packageRoot=process.env.FLOWSKETCH_PLAYWRIGHT_MODULES||resolve(root,'node_modules');
const {chromium}=createRequire(resolve(packageRoot,'playwright/package.json'))('playwright');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const report={generatedAt:new Date().toISOString(),ordinaryBuild:true,testFixtureChooser:false,webdriverCompiled:false,submittedCodeExecuted:false,cleanWindows:false};
  try{
    const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://tauri.localhost'));
    assert.ok(page,'ordinary app WebView');const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForSelector('.build-footer button.primary');
    await page.locator('.build-footer button.primary').click();
    await page.waitForSelector('[data-scene-status="ready"]',{timeout:25000});
    await page.waitForFunction(()=>!document.querySelector('.top-actions button:nth-child(2)').disabled);
    report.origin=page.url();report.nodes=await page.locator('[data-node-id]').count();assert.equal(report.nodes,10);
    report.labels=await page.locator('[data-node-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
    assert.ok(report.labels.some(label=>label.includes('continue')));
    await page.screenshot({path:resolve(root,'spikes/tauri/evidence/06-ordinary-prototype.png')});
    await page.getByRole('tab',{name:'Оформление',exact:true}).click();
    await page.getByRole('button',{name:'Шаблоны',exact:true}).click();
    await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Отмена',exact:true}).click();
    await page.locator('.properties-tabs button:last-child').click();
    await page.selectOption('#font-size','18');
    await page.waitForFunction(()=>!document.querySelector('.top-actions button:nth-child(2)').disabled&&document.querySelector('#font-size').value==='18');
    await page.getByRole('button',{name:'Закрыть приложение',exact:true}).click();
    await page.getByRole('dialog',{name:'Сохранить изменения?'}).waitFor();await page.getByRole('button',{name:'Отмена',exact:true}).click();
    report.unsavedCloseGuard=true;report.jsErrors=errors;assert.deepEqual(errors,[]);
    const executable=await fs.readFile(resolve(root,'prototype/windows-x64/FlowSketch.exe'));
    report.executableSha256=crypto.createHash('sha256').update(executable).digest('hex');
    report.success=true;console.log(JSON.stringify(report,null,2));
  }catch(error){report.success=false;report.error=error.stack;throw error;}
  finally{await fs.writeFile(resolve(root,'spikes/tauri/evidence/ordinary-prototype-report.json'),JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

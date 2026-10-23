// End-to-end smoke test for the real KYVO demo SPA. No API, DB or secrets.
import assert from 'node:assert/strict';
import process from 'node:process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist/preview');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.webm':'video/webm', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2' };
const server = createServer(async (req,res) => {
  try {
    const path = resolve(root, decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]).replace(/^[/]+/, '') || 'index.html');
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type',types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1',resolve));
const browser = await chromium.launch({headless:true});
const errors=[];
try {
  const page = await browser.newPage({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  page.on('pageerror',e => errors.push(e.message));
  const base = 'http://127.0.0.1:'+server.address().port+'/';
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#view h1').first().waitFor({timeout:20000});
  assert(!await page.getByText('Preview failed to load').count(),'Demo assets failed to load');
  for (const [hash,title] of [['#/today','Today'],['#/train','Train'],['#/nutrition','Nutrition'],['#/progress','Progress'],['#/profile','Profile']]) {
    await page.goto(base+hash,{waitUntil:'networkidle'});
    await page.locator('#view h1').first().waitFor({timeout:15000});
    assert(await page.locator('#view').innerText(),'Empty '+title+' screen');
    assert(!await page.getByText('Something went wrong',{exact:true}).count(),title+' screen crashed');
  }
  // Real workout journey using preview API: start, log a set, finish, verify summary.
  await page.goto(base+'#/train',{waitUntil:'networkidle'});
  await page.locator('#view [data-action="start"]').first().click();
  await page.locator('.kyvo-live-exercise').first().waitFor({timeout:15000});
  const first = page.locator('.kyvo-live-exercise').first();
  const weight = first.locator('.set-row').first().locator('[data-f="w"]');
  if (await weight.count()) await weight.fill('40');
  await first.locator('.set-row').first().locator('[data-f="v"]').fill('8');
  await first.locator('.set-row').first().locator('[data-action="done"]').click();
  assert.equal(await first.locator('.set-row').first().locator('[data-action="done"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-action="finish"]').first().click();
  await page.locator('#fin button[type="submit"]').click();
  await page.waitForURL(url => url.hash.startsWith('#/session/'),{timeout:15000});
  await page.locator('#view h1').first().waitFor({timeout:15000});
  assert(!await page.getByText('Something went wrong',{exact:true}).count(),'Workout completion failed');
  assert.deepEqual(errors,[], 'Browser uncaught errors: '+errors.join('; '));
  process.stdout.write('KYVO preview smoke: mobile load, five routes, no page errors OK\n');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }

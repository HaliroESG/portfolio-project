// Local render of actual FX pages/components with real SWR, synthetic IO only.
// Existing installed Playwright + Next compiler; no download or app auth needed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { chromium } = require('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.indexOf('--output-dir')
const output = arg >= 0 ? path.resolve(process.argv[arg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-fx-l1-'))
fs.mkdirSync(output, { recursive: true })
const input = fs.readFileSync(path.join(root, '../backend/tests/fixtures/fx_contracts_v1.json'), 'utf8')
const child = spawnSync('python3.11', ['-B', '-c', `import json,sys
sys.path.insert(0,'tests')
from source_contracts_offline_guard import install
install()
from fx_contracts import prepare_fx_series
d=json.load(sys.stdin)
print(json.dumps([prepare_fx_series(c['rows'],currency=c['currency'],now=d['now'],calendar=c['calendar']) for c in d['cases']],allow_nan=False))`],
{ cwd: path.join(root, '../backend'), input, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, PYTHONNOUSERSITE: '1' } })
assert.equal(child.status, 0, 'Python fixture generation')
fs.writeFileSync(path.join(output, 'payloads.json'), child.stdout)
fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}`)
fs.writeFileSync(path.join(output, 'shell.jsx'), `import { CurrencyWidget } from ${JSON.stringify(path.join(root, 'components/CurrencyWidget'))};export function AppShell({children}){return <><header className="flex justify-end border-b p-4"><CurrencyWidget /></header>{children}</>}`)
fs.writeFileSync(path.join(output, 'supabase.js'), 'export const supabase=new Proxy({}, {get(){throw new Error("Provider IO forbidden")}})')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: root,
    entry: './scripts/fixtures/fx-trace-browser.jsx', output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'], alias: {
      [path.join(root, 'components/AppShell')]: path.join(output, 'shell.jsx'),
      [path.join(root, 'lib/supabase')]: path.join(output, 'supabase.js'),
      'fx-offline-payloads': path.join(output, 'payloads.json'),
    }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
// Compile current local CSS; never rely on a stale .next output or Google fonts.
const css = (await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: false })])
  .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css
fs.writeFileSync(path.join(output, 'style.css'), css)
const html = '<!doctype html><html><head><meta charset="utf-8"><title>ASTROCYTE FX L1 offline QA</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = http.createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))) }
  else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css) }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser, page, scenarios = 0
const errors = [], external = [], screenshots = []
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const shot = async name => { const file = path.join(output, name + '.png'); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file) }
  const usd = () => page.locator('main [data-fx-rate="USD"]')
  const open = async () => { await page.getByRole('button', { name: 'Open forex rates', exact: true }).click(); await page.getByRole('region', { name: 'Forex rates details' }).waitFor() }
  const panel = () => page.getByRole('region', { name: 'Forex rates details' })
  for (const width of [1440, 390]) for (const route of ['fx', 'currencies']) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${base}/${route}?clear=1`)
    await usd().waitFor()
    assert.equal(await page.title(), 'ASTROCYTE FX L1 offline QA')
    assert.equal(new URL(page.url()).pathname, '/' + route)
    assert.equal(await page.locator('nextjs-portal').count(), 0)
    assert.equal(await usd().locator('[data-fx-value]').textContent(), '0.9900')
    assert.equal(await usd().locator('[data-fx-change]').textContent(), 'N/A')
    assert.match(await usd().innerText(), /Cotation : inconnue/)
    assert.match(await usd().innerText(), /UNKNOWN/)
    await usd().getByText('Traçabilité et variation', { exact: true }).click()
    assert.match(await usd().innerText(), /SOURCE_SESSIONS_UNVERIFIED/)
    await open()
    for (const code of ['USD', 'CHF', 'GBP', 'JPY']) {
      const main = page.locator(`main [data-fx-rate="${code}"]`), header = panel().locator(`[data-fx-rate="${code}"]`)
      assert.equal(await header.locator('[data-fx-value]').textContent(), await main.locator('[data-fx-value]').textContent())
      assert.equal(await header.locator('[data-fx-detail]').textContent(), await main.locator('[data-fx-detail]').textContent())
    }
    assert.equal((await page.evaluate(() => window.fxQa.counts()))['fx-rates-v3'], 1, 'Shared SWR read deduplicated')
    await shot(`${route}-${width}-legacy-panel`)
    await page.keyboard.press('Escape')
    assert.equal(await panel().count(), 0)
    await page.getByRole('button', { name: 'Open forex rates', exact: true }).focus()
    await page.keyboard.press('Enter')
    await panel().waitFor()
    if (width === 390) await page.getByRole('button', { name: 'Close forex rates', exact: true }).click()
    else await page.getByRole('heading', { level: 1 }).click()
    assert.equal(await panel().count(), 0)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page-level horizontal overflow')
    scenarios++
    await page.evaluate(() => window.fxQa.fail())
    await page.locator('main [role="alert"]').first().waitFor()
    assert.match(await usd().innerText(), /CACHED/)
    assert.equal(await usd().locator('[data-fx-change]').textContent(), 'N/A')
    await open(); assert.match(await panel().innerText(), /CACHED/)
    await shot(`${route}-${width}-cached-error`)
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.fxQa.recover())
    await page.waitForFunction(() => !document.querySelector('main [role="alert"]'))
    assert.match(await usd().innerText(), /UNKNOWN/); scenarios++
    for (const [scenario, expected] of [['undated', 'UNKNOWN'], ['stale', 'STALE'], ['missing', 'MISSING'], ['cache', 'CACHED']]) {
      await page.goto(`${base}/${route}?clear=1&scenario=${scenario}`)
      await usd().waitFor()
      assert.match(await usd().innerText(), new RegExp(expected))
      assert.equal(await usd().locator('[data-fx-change]').textContent(), 'N/A')
      if (scenario === 'missing') assert.equal(await usd().locator('[data-fx-value]').textContent(), 'N/A')
      if (scenario === 'cache') assert.match(await usd().innerText(), /Source : non renseignée/)
      scenarios++
    }
    for (const scenario of ['empty', 'error', 'loading']) {
      await page.goto(`${base}/${route}?clear=1&scenario=${scenario}`)
      await open()
      if (scenario === 'empty') await panel().getByText('Aucun taux disponible.').waitFor()
      if (scenario === 'error') await panel().getByRole('alert').waitFor()
      if (scenario === 'loading') {
        await panel().getByText('Chargement des taux…').waitFor()
        await page.evaluate(() => window.fxQa.recover())
        await panel().locator('[data-fx-rate="USD"]').waitFor()
      } else assert.equal(await panel().locator('[data-fx-rate]').count(), 0)
      await shot(`${route}-${width}-${scenario}`); scenarios++
    }
  }
  for (const [i, expected] of [[0, '10.00%'], [4, 'N/A'], [5, 'N/A'], [11, 'N/A']]) {
    await page.goto(`${base}/fixture?case=${i}`)
    await usd().waitFor()
    assert.match(await usd().innerText(), /FIXTURE HORS LIGNE/)
    assert.equal(await usd().locator('[data-fx-change]').textContent(), expected)
    await usd().getByText('Traçabilité et variation', { exact: true }).click()
    if (i === 0) {
      assert.match(await usd().innerText(), /Cotation : 2026-10-16/)
      assert.match(await usd().innerText(), /Collecte : 2026-10-18T10:00:00Z/)
      assert.match(await usd().innerText(), /fixture:fx-calendar@v1/)
    }
    await shot(`fixture-${i}`); scenarios++
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  const report = { status: 'PASS', scenarios, viewports: [1440, 390], screenshots,
    page_errors: errors, external_requests: external, actual_components: true, real_swr: true,
    limitations: 'Synthetic IO, AppShell shell only, local system font; no app auth/provider/runtime verification' }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, errors, external, body: await page?.locator('body').innerText() }, null, 2))
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

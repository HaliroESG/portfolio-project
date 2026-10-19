// Actual macro components, real SWR, preloaded synthetic data, loopback only.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { macroFixtures, root as repo } from './macro-fixture-payloads.mjs'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { chromium } = require('playwright')
const root = path.join(repo, 'frontend')
const arg = process.argv.indexOf('--output-dir')
const output = arg >= 0 ? path.resolve(process.argv[arg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-macro-l2-'))
fs.mkdirSync(output, { recursive: true })
const { payloads } = macroFixtures()
fs.writeFileSync(path.join(output, 'payloads.json'), JSON.stringify(payloads))
fs.writeFileSync(path.join(output, 'loader.cjs'), 'const ts=require(' + JSON.stringify(require.resolve('typescript'))
  + ');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}')
fs.writeFileSync(path.join(output, 'supabase.js'), 'export const supabase=new Proxy({}, {get(){throw new Error("Provider IO forbidden")}})')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: root,
    entry: './scripts/fixtures/macro-trace-browser.jsx', output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'], alias: {
      [path.join(root, 'lib/supabase')]: path.join(output, 'supabase.js'),
      'macro-offline-payloads': path.join(output, 'payloads.json'),
    }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const css = (await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: false })])
  .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css
fs.writeFileSync(path.join(output, 'style.css'), css)
const html = '<!doctype html><html><head><meta charset="utf-8"><title>ASTROCYTE Macro L2 offline QA</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = http.createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))) }
  else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css) }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port
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
  // Finish finite entrance animations before the visual evidence is captured.
  const shot = async name => { const file = path.join(output, name + '.png'); await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); screenshots.push(file) }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [scenario, expected] of [['legacy', 'UNKNOWN'], ['stale', 'STALE'], ['missing', 'MISSING'], ['undated', 'UNKNOWN'], ['empty', 'MISSING'], ['error', 'ERROR'], ['loading', 'LOADING']]) {
      await page.goto(base + '/macro-components?scenario=' + scenario)
      assert.equal(await page.title(), 'ASTROCYTE Macro L2 offline QA')
      assert.equal(new URL(page.url()).pathname, '/macro-components')
      await page.getByText(expected + ' CONDITIONS', { exact: true }).waitFor()
      assert.equal(await page.locator('nextjs-portal').count(), 0)
      assert.ok(await page.getByRole('heading', { level: 1 }).count())
      assert.equal(await page.getByText('NORMAL CONDITIONS', { exact: true }).count(), 0)
      assert.equal(await page.getByText('No immediate tactical triggers detected.', { exact: true }).count(), 0)
      if (scenario === 'legacy') {
        const detail = page.locator('[data-macro-details="^VIX"]')
        await detail.locator('summary').focus()
        await page.keyboard.press('Enter')
        assert.equal(await detail.getAttribute('open'), '')
        assert.match(await detail.innerText(), /Observation source : non attestée/)
        assert.match(await detail.innerText(), /Unité : non attestée/)
        await shot('macro-' + width + '-legacy-details')
        const readable = await page.locator('[data-macro-card="^VIX"]').evaluate(card => {
          const style = getComputedStyle(card)
          return { background: style.backgroundColor, columns: style.gridColumnEnd,
            entranceOpacity: getComputedStyle(card.parentElement.parentElement).opacity }
        })
        assert.ok(['rgb(255, 255, 255)', 'color(srgb 1 1 1)'].includes(readable.background), 'Neutral light card is opaque and readable')
        assert.equal(readable.columns, 'span 2')
        assert.equal(readable.entranceOpacity, '1')
        await page.evaluate(() => window.macroQa.fail())
        await page.getByText('ERROR CONDITIONS', { exact: true }).waitFor()
        assert.match(await page.locator('body').innerText(), /ERROR · cache/)
        await page.evaluate(() => window.macroQa.recover())
        await page.getByText('UNKNOWN CONDITIONS', { exact: true }).waitFor()
      }
      if (scenario === 'loading') {
        await page.evaluate(() => window.macroQa.recover())
        await page.getByText('UNKNOWN CONDITIONS', { exact: true }).waitFor()
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal overflow')
      scenarios++
    }
    for (const [i, expected] of [[0, 'VALIDATED'], [13, 'CONFLICT'], [17, 'MISSING'], [21, 'VALIDATED'], [26, 'VALIDATED']]) {
      await page.goto(base + '/fixture?case=' + i)
      const detail = page.locator('[data-macro-details]')
      await detail.locator('summary').click()
      assert.match(await detail.innerText(), new RegExp('FIXTURE HORS LIGNE · ' + expected))
      assert.match(await page.locator('[data-strategy]').innerText(), /Régime : UNKNOWN · Cible applicable : false/)
      if (i === 21) {
        assert.match(await detail.innerText(), /14 entrées liées/)
        assert.match(await detail.innerText(), /2026-09-01 → 2026-09-30/)
      }
      if (i === 26) assert.match(await detail.innerText(), /REALIZED_NOT_IMPLIED/)
      await shot('macro-' + width + '-fixture-' + i)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No detail overflow')
      scenarios++
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  const report = { status: 'PASS', scenarios, viewports: [1440, 390], screenshots,
    page_identity: 'PASS loopback QA routes', not_blank: 'PASS', framework_overlay: 'NONE',
    keyboard_details_and_cache_recovery: 'PASS', page_errors: errors, external_requests: external,
    tactical_quarantine: 'PASS including historical READY fixture', actual_components: true,
    limitations: 'Component harness only, real SWR with synthetic reads, local fonts; no full /mdss route, auth or Production test.',
    browser_plugin: 'NOT_AVAILABLE', browser: 'installed Playwright Chromium',
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, errors, external, body: await page?.locator('body').innerText() }, null, 2))
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

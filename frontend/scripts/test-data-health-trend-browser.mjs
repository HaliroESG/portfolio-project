// Render the real panel with synthetic reads only. Browser/provider IO is denied.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { chromium } = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const arg = process.argv.indexOf('--output-dir')
if (arg >= 0 && !process.argv[arg + 1]) throw new Error('--output-dir needs a path')
const output = arg >= 0 ? path.resolve(process.argv[arg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-health-r006-'))
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'loader.cjs'), 'const ts=require(' + JSON.stringify(require.resolve('typescript'))
  + ');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: root,
    entry: './scripts/fixtures/data-health-trend-browser.jsx', output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'], alias: {
      [path.join(root, 'lib/supabase')]: path.join(root, 'scripts/fixtures/data-health-offline-supabase.mjs'),
    }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const css = (await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: false })])
  .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css
fs.writeFileSync(path.join(output, 'style.css'), css)
const title = 'ASTROCYTE Data health R006 offline QA'
const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + title
  + '</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = http.createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))) }
  else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css) }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port
const expected = [
  ['no-attempts', 'success rate', [100, null], 'insufficient history'],
  ['true-zero', 'success rate', [100, 0], 'insufficient history'],
  ['failed-partial', 'success rate', [100, 80], 'insufficient history'],
  ['mixed', 'success rate', [100, 70, null, null], 'insufficient history'],
  ['coverage', 'coverage', [75, 0, null], 'insufficient history'],
  ['status', 'status score', [100, 0, null], 'insufficient history'],
  ['missing', 'status score', [null, null], 'insufficient history'],
  ['legacy', 'success rate', [80, null], 'insufficient history'],
  ['improving', 'success rate', [40, null, 50, 80, 90, null], 'improving'],
]
let browser, page
const errors = [], external = [], screenshots = [], results = []
const report = status => ({ status, scenarios: results.length, results, errors, external, screenshots,
  scope: 'Actual DataHealthPanel + pure trend helper, synthetic transport, desktop/mobile. No live Supabase, auth, Next server, activation, CI or Production proof.' })
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [scenario, basis, values, direction] of expected) {
      await page.goto(base + '/data-health?scenario=' + scenario)
      assert.equal(await page.title(), title)
      assert.equal(new URL(page.url()).pathname, '/data-health')
      await page.getByRole('heading', { level: 1, name: 'ASTROCYTE — Data health offline QA' }).waitFor()
      assert.equal(await page.locator('nextjs-portal').count(), 0)
      const open = page.getByRole('button', { name: 'Show details' })
      await open.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'Data operations details' })
      await dialog.waitFor()
      const chart = dialog.getByRole('list', { name: 'equity_publications_sync: ' + basis + ' history', exact: true })
      await chart.waitFor()
      await chart.scrollIntoViewIfNeeded()
      const points = chart.getByRole('listitem')
      assert.equal(await points.count(), values.length)
      for (const [i, value] of values.entries()) {
        const node = points.nth(i)
        const suffix = value === null ? 'not computable' : value.toFixed(1) + (basis === 'status score' ? '/100' : '%')
        const date = '2026-10-' + String(i + 10).padStart(2, '0') + 'T12:00:00Z'
        assert.equal(await node.getAttribute('aria-label'), date + ' · ' + basis + ': ' + suffix)
        assert.equal(await node.getAttribute('title'), await node.getAttribute('aria-label'))
        const marker = node.locator('span')
        if (value === null) {
          assert.equal(await marker.innerText(), '—')
          assert.equal(await marker.evaluate(el => el.style.height), '')
        } else {
          assert.equal(await marker.evaluate(el => el.style.height), value + '%')
          assert.equal(await marker.evaluate(el => el.style.minHeight), '2px')
        }
      }
      assert.match(await dialog.innerText(), new RegExp('trend ' + direction + ' \\(' + basis))
      const missing = values.filter(value => value === null).length
      if (missing) assert.ok((await dialog.innerText()).includes(`— not computable (${missing}/${values.length} runs); excluded from trend`))
      else assert.equal(await dialog.getByText(/not computable/).count(), 0)
      if (scenario === 'no-attempts') {
        assert.match(await dialog.innerText(), /items 0 · ok 0 · fail 0 · coverage 0\.0%/)
        assert.equal(await chart.getByRole('listitem', { name: /success rate: 0\.0%/ }).count(), 0)
      }
      if (scenario === 'improving') assert.match(await dialog.innerText(), /\+40\.0 pts/)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page overflow')
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No dialog overflow')
      const transport = await page.evaluate(() => window.dataHealthQa)
      assert.equal(transport.scenario, scenario)
      assert.ok(transport.reads.some(read => read.table === 'etl_runs' && !read.single))
      assert.deepEqual(transport.mutations, [])
      if (['no-attempts', 'true-zero', 'coverage', 'status', 'improving'].includes(scenario)) {
        const file = path.join(output, `data-health-${width}-${scenario}.png`)
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
        screenshots.push(file)
      }
      await dialog.getByRole('button', { name: 'Close data health details' }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Show details' }).click()
      await chart.waitFor()
      assert.equal(await chart.getByRole('listitem').count(), values.length)
      results.push({ width, scenario, basis, values, direction, fixture_reads: transport.reads.length })
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report('PASS'), null, 2))
  console.log(JSON.stringify(report('PASS'), null, 2))
} catch (error) {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report('FAIL'), failure: String(error) }, null, 2))
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

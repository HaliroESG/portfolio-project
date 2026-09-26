import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const { chromium } = require('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-source-state-'))
const baselineRef = process.argv[process.argv.indexOf('--baseline-ref') + 1]
const baseline = process.argv.includes('--baseline-ref')
if (baseline) {
  for (const route of ['targets', 'arbitrage']) fs.writeFileSync(path.join(output, `${route}.tsx`), execFileSync('git', ['show', `${baselineRef}:frontend/app/${route}/page.tsx`], { cwd: root }))
}
// Generated test-only modules live outside the repository. No new dependency.
fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){${baseline ? `for(const route of ['targets','arbitrage'])if(this.resourcePath===${JSON.stringify(root)}+'/app/'+route+'/page.tsx')source=require('fs').readFileSync(${JSON.stringify(output)}+'/'+route+'.tsx','utf8');` : ''}return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText}`)
fs.writeFileSync(path.join(output, 'shell.jsx'), 'export function AppShell({children}) { return children }')
fs.writeFileSync(path.join(output, 'supabase.js'), 'export const supabase = new Proxy({}, {get(){throw new Error("Provider IO forbidden")}})')
fs.writeFileSync(path.join(output, 'macro.js'), 'export function loadMacroAllocationAdvice(){throw new Error("Provider IO forbidden")}')
await new Promise((resolve, reject) => {
  const compiler = webpack({
    mode: 'development', devtool: false, context: root,
    entry: './scripts/fixtures/source-state-browser.jsx',
    output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'], alias: {
      [path.join(root, 'components/AppShell')]: path.join(output, 'shell.jsx'),
      [path.join(root, 'lib/supabase')]: path.join(output, 'supabase.js'),
      [path.join(root, 'lib/macroStrategyData')]: path.join(output, 'macro.js'),
    }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const cssDir = path.join(root, '.next/static/chunks')
const css = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(x => x.endsWith('.css')).map(x => fs.readFileSync(path.join(cssDir, x), 'utf8')).join('\n') : ''
const html = '<!doctype html><html><head><meta charset="utf-8"><title>ASTROCYTE source-state QA</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = http.createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))) }
  else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css) }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser, page, scenarios = 0
const errors = [], external = []
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
  const hidden = async (state) => {
    await page.locator(`[data-source-state="${state}"]`).waitFor()
    assert.equal(await page.getByText('Actions', { exact: true }).count(), 0, 'No cached action totals')
    assert.equal(await page.getByText('Gross trade', { exact: true }).count(), 0, 'No cached trade totals')
    assert.equal(await page.getByText('Holding p1 1', { exact: true }).count(), 0, 'No stale positions')
    assert.equal(await page.getByText('Advice PERSO', { exact: true }).count(), 0, 'No stale advice')
    assert.equal(await page.getByText('Macro p1', { exact: true }).count(), 0, 'No stale macro')
  }
  const ready = async () => { await page.getByText('Actions', { exact: true }).first().waitFor(); assert.equal(await page.locator('[data-source-state]').count(), 0) }
  for (const width of [1440, 390]) for (const route of ['targets', 'arbitrage']) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base + '/' + route)
    await ready()
    assert.equal(await page.title(), 'ASTROCYTE source-state QA')
    assert.equal(new URL(page.url()).pathname, '/' + route)
    assert.equal(await page.locator('nextjs-portal').count(), 0)
    await page.screenshot({ path: path.join(output, `${route}-${width}-ready.png`), fullPage: true })
    const sources = ['portfolios', 'models', 'allocation', 'lines', ...(route === 'targets' ? ['buckets'] : ['advice', 'macro', 'execution'])]
    for (const scope of ['PERSO', 'PRO']) {
      if (scope === 'PRO') {
        if (route === 'targets') await page.getByRole('button', { name: 'PRO', exact: true }).click()
        else await page.getByRole('combobox', { name: 'Scope' }).selectOption('PRO')
        await ready()
      }
      for (const source of sources) {
        await page.evaluate(source => window.qa.revalidate(source, 'hold'), source)
        await hidden('REVALIDATING')
        const observed = await page.evaluate(source => window.qa.observed()[source], source)
        assert.deepEqual(observed, { isLoading: false, isValidating: true, hasData: true }, 'Real cached SWR revalidation')
        scenarios++
        await page.evaluate(source => window.qa.recover(source), source)
        await ready()
        await page.evaluate(source => window.qa.revalidate(source, 'error'), source)
        await hidden('ERROR'); scenarios++
        // Restore the simulated network, then recover via the real visible UI.
        await page.evaluate(source => window.qa.setMode(source, null), source)
        await page.getByRole('button', { name: 'Retry sources', exact: true }).click()
        await ready()
      }
    }
    await page.goto(base + '/' + route)
    await ready()
    // During a source error, change scope through the recovery UI. The old scope
    // must not reappear while the new key is fetching.
    await page.evaluate(() => { window.qa.revalidate('portfolios', 'error'); window.qa.setMode('lines', 'hold') })
    await hidden('ERROR')
    await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('PRO')
    await page.evaluate(() => window.qa.recover('portfolios'))
    await hidden('LOADING')
    await page.screenshot({ path: path.join(output, `${route}-${width}-loading.png`), fullPage: true })
    await page.evaluate(() => window.qa.recover('lines'))
    await ready(); scenarios++
    // A removed selection must never silently switch to another portfolio.
    await page.locator('select').first().selectOption('p2')
    await ready()
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'Portfolio one' }]))
    await hidden('UNAVAILABLE')
    await page.getByRole('combobox', { name: 'Portfolio', exact: true }).selectOption('p1')
    await ready(); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'One' }, { id: 'p1', name: 'Duplicate' }]))
    await hidden('UNAVAILABLE'); scenarios++
    await page.goto(base + '/' + route + '?hold=portfolios')
    await hidden('LOADING'); scenarios++
    await page.evaluate(() => window.qa.recover('portfolios'))
    await ready()

    // The implicit initial selection must survive reorder, disappearance and
    // return; it must never follow a new first row without user input.
    await page.goto(base + '/' + route)
    await ready()
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p2', name: 'Two' }, { id: 'p1', name: 'One' }]))
    await ready()
    assert.equal(await page.locator('select').first().inputValue(), 'p1')
    assert.equal(await page.evaluate(() => window.qa.activeKey('allocation')[1]), 'p1'); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p2', name: 'Two' }]))
    await hidden('UNAVAILABLE')
    assert.equal(await page.evaluate(() => window.qa.activeKey('allocation')[1]), 'p1'); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }]))
    await ready()
    assert.equal(await page.locator('select').first().inputValue(), 'p1'); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p2', name: 'Two' }]))
    await hidden('UNAVAILABLE')
    await page.evaluate(() => window.qa.setMode('allocation', 'hold'))
    await page.getByRole('combobox', { name: 'Portfolio', exact: true }).selectOption('p2')
    await hidden('LOADING')
    await page.evaluate(() => window.qa.recover('allocation'))
    await ready()
    assert.equal(await page.evaluate(() => window.qa.activeKey('allocation')[1]), 'p2'); scenarios++

    // Failed retry stays fail-closed; delayed retry is single-flight and can
    // recover without a private cache mutation/revalidation call.
    await page.goto(base + '/' + route); await ready()
    await page.evaluate(() => window.qa.revalidate('portfolios', 'error'))
    await hidden('ERROR')
    await page.screenshot({ path: path.join(output, `${route}-${width}-retry-error.png`), fullPage: true })
    const attempts = await page.evaluate(() => window.qa.fetchCounts().portfolios)
    await page.getByRole('button', { name: 'Retry sources', exact: true }).click()
    await page.waitForFunction(n => window.qa.fetchCounts().portfolios > n && !window.qa.observed().portfolios.isValidating, attempts)
    await hidden('ERROR'); scenarios++
    await page.evaluate(() => window.qa.setMode('portfolios', 'hold'))
    await page.getByRole('button', { name: 'Retry sources', exact: true }).click()
    await page.getByRole('button', { name: 'Retrying sources…', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Retrying sources…', exact: true }).isDisabled(), true)
    await hidden('ERROR')
    await page.evaluate(() => window.qa.recover('portfolios'))
    await ready(); scenarios++

    if (route === 'arbitrage') {
      for (const overlay of ['STANDARD', 'MACRO']) {
        const hiddenSources = overlay === 'STANDARD' ? ['macro'] : ['models', 'allocation', 'lines', 'advice', 'execution']
        for (const source of hiddenSources) for (const mode of ['hold', 'error']) {
          await page.goto(base + '/arbitrage'); await ready()
          await page.getByRole('combobox', { name: 'Overlay', exact: true }).selectOption(overlay)
          await page.evaluate(([source, mode]) => window.qa.revalidate(source, mode), [source, mode])
          await page.waitForFunction(([source, mode]) => mode === 'hold' ? window.qa.observed()[source].isValidating : !window.qa.observed()[source].isValidating, [source, mode])
          assert.equal(await page.locator('[data-source-state]').count(), 0)
          const visibleTitle = overlay === 'MACRO' ? 'Macro overlay' : 'Execution universe'
          await page.getByRole('heading', { name: visibleTitle, exact: true }).waitFor()
          if (overlay === 'MACRO') {
            assert.equal(await page.getByText('Liquid allocation', { exact: true }).count(), 0)
            assert.equal(await page.getByText('Advice PERSO', { exact: true }).count(), 0)
            assert.equal(await page.getByRole('combobox', { name: 'Data issue', exact: true }).count(), 0)
          } else assert.equal(await page.getByRole('heading', { name: 'Macro overlay', exact: true }).count(), 0)
          // Switching to the failing dependency blocks; recovery Overlay remains available.
          await page.getByRole('combobox', { name: 'Overlay', exact: true }).selectOption('ALL')
          await hidden(mode === 'hold' ? 'REVALIDATING' : 'ERROR')
          await page.getByRole('combobox', { name: 'Overlay', exact: true }).selectOption(overlay)
          await page.getByRole('heading', { name: visibleTitle, exact: true }).waitFor()
          assert.equal(await page.locator('[data-source-state]').count(), 0)
          scenarios++
        }
      }
      // Cold start: a hidden source may still be unresolved, not just cached.
      await page.goto(base + '/arbitrage?hold=models')
      await hidden('LOADING')
      await page.getByRole('combobox', { name: 'Overlay', exact: true }).selectOption('MACRO')
      await page.getByRole('heading', { name: 'Macro overlay', exact: true }).waitFor()
      assert.equal(await page.locator('[data-source-state]').count(), 0)
      await page.screenshot({ path: path.join(output, `arbitrage-${width}-macro-recovered.png`), fullPage: true }); scenarios++
      await page.goto(base + '/arbitrage?hold=macro')
      await hidden('LOADING')
      await page.getByRole('combobox', { name: 'Overlay', exact: true }).selectOption('STANDARD')
      await ready(); scenarios++
    }
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log(JSON.stringify({ status: 'PASS', scenarios, output, base, viewports: [1440, 390], real_swr: true, page_errors: errors, external_requests: external, limitations: 'Synthetic IO; AppShell stub; no auth/provider/runtime verification' }))
} catch (error) {
  console.error(JSON.stringify({ errors, external, body: await page?.locator('body').innerText(), observed: await page?.evaluate(() => window.qa?.observed()) }))
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

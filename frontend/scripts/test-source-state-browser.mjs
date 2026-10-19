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
const css = ['.next/static/chunks', '.next/static/css'].flatMap(relative => {
  const dir = path.join(root, relative)
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.css')).map(x => fs.readFileSync(path.join(dir, x), 'utf8')) : []
}).join('\n')
if (process.argv.includes('--require-css')) assert.ok(css.length > 0, 'Run a production build before styled viewport checks')
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
    if (css) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Recovery UI stays inside the viewport')
    assert.equal(await page.getByText('Actions', { exact: true }).count(), 0, 'No cached action totals')
    assert.equal(await page.getByText('Gross trade', { exact: true }).count(), 0, 'No cached trade totals')
    assert.equal(await page.getByText('Holding p1 1', { exact: true }).count(), 0, 'No stale positions')
    assert.equal(await page.getByText('Advice PERSO', { exact: true }).count(), 0, 'No stale advice')
    assert.equal(await page.getByText('Advice PRO', { exact: true }).count(), 0, 'No cross-scope advice')
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
    const sources = ['portfolios', 'models', 'allocation', 'lines', 'buckets', ...(route === 'arbitrage' ? ['advice', 'macro', 'execution'] : [])]
    for (const scope of ['PERSO', 'PRO']) {
      if (scope === 'PRO') {
        await page.goto(base + '/' + route + '?portfolioType=PROFESSIONAL'); await ready()
        assert.equal(await page.evaluate(() => window.qa.activeKey('lines')[1]), 'PRO', 'Native PROFESSIONAL portfolio uses the PRO model')
        if (route === 'arbitrage') assert.equal(await page.evaluate(() => window.qa.activeKey('advice')[1]), 'PRO')
        scenarios++
      }
      for (const source of [...sources, ...(scope === 'PRO' ? ['sleeves'] : [])]) {
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
    // Cold missing contracts show the actual failing source, not raw SQL/PII,
    // and never disclose cached calculations while the schema is unavailable.
    await page.goto(base + '/' + route + '?schema=models')
    await hidden('ERROR')
    await page.getByLabel('Source diagnostics').getByText('Target models', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-source-failure="SCHEMA_UNAVAILABLE"]').count(), 1)
    assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE'))
    await page.screenshot({ path: path.join(output, `${route}-${width}-schema-blocked.png`), fullPage: true })
    await page.evaluate(() => window.qa.setMode('models', null))
    await page.getByRole('button', { name: 'Retry sources', exact: true }).click()
    await ready()
    assert.equal(await page.locator('[data-source-failure]').count(), 0)
    await page.evaluate(() => window.qa.revalidate('portfolios', 'access'))
    await hidden('ERROR')
    assert.equal(await page.locator('[data-source-failure="ACCESS_REQUIRED"]').count(), 1)
    assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE'))
    scenarios += 2

    // Empty successful parents do not wait forever for disabled dependent keys.
    await page.goto(base + '/' + route + '?empty=portfolios')
    await hidden('UNAVAILABLE')
    assert.equal(await page.getByRole('combobox', { name: 'Scope', exact: true }).inputValue(), '')
    assert.equal(await page.evaluate(() => window.qa.fetchCounts().allocation ?? 0), 0)
    assert.equal(await page.evaluate(() => window.qa.fetchCounts().advice ?? 0), 0)
    scenarios++
    await page.goto(base + '/' + route + '?portfolioType=UNKNOWN')
    await hidden('UNAVAILABLE')
    assert.equal(await page.getByRole('combobox', { name: 'Scope', exact: true }).inputValue(), '')
    assert.equal(await page.evaluate(() => window.qa.fetchCounts().advice ?? 0), 0)
    scenarios++
    if (route === 'targets') {
      await page.goto(base + '/targets?empty=models')
      await page.getByText('No target model imported for PERSO.', { exact: false }).waitFor()
      assert.equal(await page.locator('[data-source-state]').count(), 0)
      for (const dependent of ['lines', 'buckets', 'sleeves']) {
        assert.equal(await page.evaluate(source => window.qa.fetchCounts()[source] ?? 0, dependent), 0)
      }
      scenarios++
    }
    // An override selected during an error cannot supersede recovered identity.
    for (const [type, nativeScope, opposite] of [['PERSONAL', 'PERSO', 'PRO'], ['PROFESSIONAL', 'PRO', 'PERSO']]) {
      await page.goto(base + '/' + route + '?portfolioType=' + type); await ready()
      await page.evaluate(() => window.qa.revalidate('portfolios', 'error'))
      await hidden('ERROR')
      await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption(opposite)
      await page.evaluate(() => window.qa.recover('portfolios'))
      await hidden('UNAVAILABLE')
      const incompatibleReads = await page.evaluate(opposite => window.qa.requests().filter(request => ['lines', 'buckets', 'sleeves', 'advice'].includes(request.name) && request.key[1] === opposite), opposite)
      assert.deepEqual(incompatibleReads, [], 'Never fetch model dependencies/advice for an incompatible scope')
      await page.screenshot({ path: path.join(output, `${route}-${width}-${type}-scope-blocked.png`), fullPage: true })
      // UNKNOWN stays blocked with either override, including a persistent one.
      await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'One', portfolio_type: 'UNKNOWN' }]))
      await hidden('UNAVAILABLE')
      for (const scope of [nativeScope, opposite]) {
        await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption(scope)
        await hidden('UNAVAILABLE')
      }
      await page.evaluate(type => window.qa.replace('portfolios', [{ id: 'p1', name: 'One', portfolio_type: type }]), type)
      await hidden('UNAVAILABLE')
      await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption(nativeScope)
      await ready()
      assert.equal(await page.evaluate(() => window.qa.activeKey('lines')[1]), nativeScope)
      if (route === 'arbitrage') {
        assert.equal(await page.evaluate(() => window.qa.activeKey('advice')[1]), nativeScope)
        // Even MACRO-only cannot turn a wrong portfolio/model identity READY.
        await page.getByRole('combobox', { name: 'Overlay', exact: true }).selectOption('MACRO')
        await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption(opposite)
        await hidden('UNAVAILABLE')
        await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption(nativeScope)
        await page.getByRole('heading', { name: 'Macro overlay', exact: true }).waitFor()
      }
      scenarios += route === 'arbitrage' ? 6 : 5
    }
    if (route === 'targets') {
      for (const type of ['PERSONAL', 'UNKNOWN']) {
        await page.goto(base + '/targets?scope=PRO&portfolioType=' + type)
        await hidden('UNAVAILABLE')
        assert.equal(await page.evaluate(() => window.qa.fetchCounts().lines ?? 0), 0, 'URL scope cannot bypass identity')
        scenarios++
      }
      await page.goto(base + '/targets?scope=PRO&portfolioType=PROFESSIONAL'); await ready(); scenarios++
    }
    // A compatible cold PRO identity still waits for its new model's data.
    await page.goto(base + '/' + route + '?portfolioType=PROFESSIONAL&hold=lines')
    await hidden('LOADING')
    await page.screenshot({ path: path.join(output, `${route}-${width}-loading.png`), fullPage: true })
    await page.evaluate(() => window.qa.recover('lines'))
    await ready(); scenarios++
    await page.goto(base + '/' + route); await ready()
    // A removed selection must never silently switch to another portfolio.
    await page.locator('select').first().selectOption('p2')
    await ready()
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'Portfolio one', portfolio_type: 'PERSONAL' }]))
    await hidden('UNAVAILABLE')
    await page.getByRole('combobox', { name: 'Portfolio', exact: true }).selectOption('p1')
    await ready(); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'One', portfolio_type: 'PERSONAL' }, { id: 'p1', name: 'Duplicate', portfolio_type: 'PERSONAL' }]))
    await hidden('UNAVAILABLE'); scenarios++
    await page.goto(base + '/' + route + '?hold=portfolios')
    await hidden('LOADING'); scenarios++
    await page.evaluate(() => window.qa.recover('portfolios'))
    await ready()

    // The implicit initial selection must survive reorder, disappearance and
    // return; it must never follow a new first row without user input.
    await page.goto(base + '/' + route)
    await ready()
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p2', name: 'Two', portfolio_type: 'PERSONAL' }, { id: 'p1', name: 'One', portfolio_type: 'PERSONAL' }]))
    await ready()
    assert.equal(await page.locator('select').first().inputValue(), 'p1')
    assert.equal(await page.evaluate(() => window.qa.activeKey('allocation')[1]), 'p1'); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p2', name: 'Two', portfolio_type: 'PERSONAL' }]))
    await hidden('UNAVAILABLE')
    assert.equal(await page.evaluate(() => window.qa.activeKey('allocation')[1]), 'p1'); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p1', name: 'One', portfolio_type: 'PERSONAL' }, { id: 'p2', name: 'Two', portfolio_type: 'PERSONAL' }]))
    await ready()
    assert.equal(await page.locator('select').first().inputValue(), 'p1'); scenarios++
    await page.evaluate(() => window.qa.replace('portfolios', [{ id: 'p2', name: 'Two', portfolio_type: 'PERSONAL' }]))
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
      // Two portfolios can share a scope/model, never advice identity or cache.
      for (const [type, scope] of [['PERSONAL', 'PERSO'], ['PROFESSIONAL', 'PRO']]) {
        await page.goto(base + '/arbitrage?portfolioType=' + type); await ready()
        await page.evaluate(type => window.qa.replace('portfolios', [{ id: 'p1', name: 'One', portfolio_type: type }, { id: 'p2', name: 'Two', portfolio_type: type }]), type)
        await ready()
        const firstAdvice = await page.evaluate(() => window.qa.cached('advice'))
        const before = await page.evaluate(() => window.qa.fetchCounts().advice)
        await page.evaluate(() => window.qa.setMode('advice', 'hold'))
        await page.locator('select').first().selectOption('p2')
        await hidden('LOADING')
        assert.deepEqual(await page.evaluate(() => window.qa.activeKey('advice')), ['allocation-advice', scope, 'p2'])
        assert.equal(await page.evaluate(() => window.qa.cached('advice')), undefined)
        await page.evaluate(() => window.qa.recover('advice')); await ready()
        assert.ok(await page.evaluate(n => window.qa.fetchCounts().advice > n, before))
        assert.equal(await page.evaluate(() => window.qa.cached('advice')[0].portfolio_id), 'p2')
        const selectedAdvice = await page.evaluate(() => window.qa.cached('advice'))
        const foreign = { ...firstAdvice[0], bucket_label: 'Foreign advice must stay hidden' }
        for (const data of [
          [foreign], [...selectedAdvice, foreign],
          [{ ...selectedAdvice[0], portfolio_id: null }],
          [{ ...selectedAdvice[0], portfolio_scope: scope === 'PRO' ? 'PERSO' : 'PRO' }],
        ]) {
          await page.evaluate(data => window.qa.replace('advice', data), data)
          await hidden('UNAVAILABLE')
          assert.equal(await page.getByText('Foreign advice must stay hidden', { exact: true }).count(), 0)
          if (data[0]?.bucket_label === 'Foreign advice must stay hidden') {
            await page.screenshot({ path: path.join(output, `arbitrage-${width}-${scope}-foreign-advice-blocked.png`), fullPage: true })
          }
          await page.evaluate(() => window.qa.recover('advice')); await ready()
          scenarios++
        }
        await page.evaluate(() => window.qa.replace('advice', [])); await ready()
        await page.getByText('No allocation advice', { exact: true }).waitFor()
        await page.evaluate(() => window.qa.recover('advice')); await ready()
        await page.screenshot({ path: path.join(output, `arbitrage-${width}-${scope}-portfolio-p2.png`), fullPage: true })
        await page.locator('select').first().selectOption('p1'); await ready()
        assert.equal(await page.evaluate(() => window.qa.cached('advice')[0].portfolio_id), 'p1', 'Returning to p1 cannot reuse p2 advice')
        scenarios += 3
      }
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
  console.log(JSON.stringify({ status: 'PASS', scenarios, output, base, viewports: [1440, 390], real_swr: true, production_css: css.length > 0, page_errors: errors, external_requests: external, limitations: 'Synthetic IO; AppShell stub; no auth/provider/runtime verification' }))
} catch (error) {
  console.error(JSON.stringify({ errors, external, body: await page?.locator('body').innerText(), observed: await page?.evaluate(() => window.qa?.observed()) }))
  throw error
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

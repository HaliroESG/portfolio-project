// Real UI + readers + chart engines; synthetic transport, no remote traffic.
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
const output = arg >= 0 ? path.resolve(process.argv[arg + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-research-qa-'))
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'loader.cjs'), 'const ts=require(' + JSON.stringify(require.resolve('typescript')) + ');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText}')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: root, entry: './scripts/fixtures/research-browser.jsx', output: { path: output, filename: 'bundle.js', publicPath: '/' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'], alias: {
      [path.join(root, 'lib/supabase')]: path.join(root, 'scripts/fixtures/research-offline-supabase.mjs'),
      'next/navigation$': path.join(root, 'scripts/fixtures/research-navigation.jsx'),
      'next/link$': path.join(root, 'scripts/fixtures/research-navigation.jsx'),
      'next/dynamic$': path.join(root, 'scripts/fixtures/research-dynamic.jsx'),
    }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const css = (await require('postcss')([require('@tailwindcss/postcss')({ base: root, optimize: false })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css
fs.writeFileSync(path.join(output, 'style.css'), css)
const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>ASTROCYTE — recherche, recette locale</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/bundle.js"></script></body></html>'
fs.writeFileSync(path.join(output, 'index.html'), html)
const server = http.createServer((req, res) => {
  const filename = path.basename(new URL(req.url, 'http://127.0.0.1').pathname)
  if ((filename.endsWith('.js') || filename === 'style.css') && fs.existsSync(path.join(output, filename))) {
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'application/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(output, filename)))
  } else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port
if (process.argv.includes('--serve')) {
  console.log(JSON.stringify({ url: `${base}/research`, output, mode: 'synthetic local preview only' }))
  await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  await new Promise(resolve => server.close(resolve))
  process.exit(0)
}
let browser, page
const errors = [], external = [], results = [], screenshots = []
const report = status => ({ status, results, errors, external, screenshots, scope: 'Real React UI, typed readers, chart and publications; synthetic transport and Next navigation adapter. No live Supabase, provider, auth/server, CI or Production proof.' })
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  page = await context.newPage(); page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const shot = async name => { const file = path.join(output, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); screenshots.push(file) }
  const fit = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page must not overflow horizontally')
  const settleUi = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto(base + '/research'); await page.getByRole('heading', { name: 'Screener & Top Quality' }).waitFor()
    await page.getByLabel('Rechercher une valeur', { exact: false }).waitFor()
    await shot(`research-${width}`); await fit()
    assert.equal(await page.getByRole('link', { name: 'Aster Systems', exact: true }).count(), 1) // Exactly one accessible responsive alternative.
    await page.getByRole('button', { name: 'Page suivante', exact: true }).click()
    await page.getByText('Page 2 / 2', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Page précédente', exact: true }).click()
    await page.getByLabel('Rechercher une valeur', { exact: false }).fill('Aster')
    if (width < 640) await page.getByRole('button', { name: /Affiner les résultats/ }).click()
    await page.getByLabel('Profil d’exploration').selectOption('ESN_UNIVERSE')
    await page.getByText('Filtres avancés & tri', { exact: true }).click()
    for (const [label, value] of [['Secteur', 'Technology'], ['État Trident historique', 'WATCHLIST'], ['Pays', 'IT'], ['Place de cotation', 'Milan'], ['Thème', 'IT_SERVICES'], ['Tag de valorisation', 'POTENTIAL_VALUE']]) await page.getByLabel(label, { exact: true }).selectOption(value)
    for (const [label, value] of [['Score minimum / 100', '90'], ['PER forward maximum (positif)', '12'], ['FCF yield minimum (%)', '8']]) await page.getByLabel(label, { exact: true }).fill(value)
    for (const value of ['company', 'roic', 'debt', 'pe', 'yield', 'margin', 'growth', 'marketCap', 'target', 'score']) await page.getByLabel('Trier par', { exact: true }).selectOption(value)
    await page.getByRole('button', { name: 'Décroissant', exact: true }).click()
    await page.getByRole('button', { name: 'Croissant', exact: true }).click()
    const listQuery = new URL(page.url()).search
    await page.getByRole('link', { name: 'Aster Systems', exact: true }).filter({ visible: true }).click()
    await page.getByRole('heading', { level: 1, name: 'Aster Systems', exact: true }).waitFor()
    assert.equal(await page.locator('#research-dossier-title').evaluate(el => el === document.activeElement), true)
    await fit(); await shot(`dossier-${width}`)
    await page.getByRole('tab', { name: 'Synthèse', exact: true }).focus()
    await page.keyboard.press('End'); await page.locator('#research-panel-sources').waitFor()
    await page.keyboard.press('Home'); await page.locator('#research-panel-summary').waitFor()
    if (width === 1440) {
      await page.reload(); await page.locator('#research-dossier-title').waitFor()
      assert.equal(new URL(page.url()).searchParams.get('minScore'), '90')
      await page.goBack(); await page.getByRole('heading', { name: 'Screener & Top Quality' }).waitFor()
      await page.getByRole('link', { name: 'Aster Systems', exact: true }).click()
      await page.locator('#research-dossier-title').waitFor()
    }
    for (const label of ['Qualité & critères', 'Valorisation', 'Publications', 'Données & méthode', 'Société & analyses']) {
      await page.getByRole('tab', { name: label, exact: true }).click()
      const panel = page.getByRole('tabpanel'); await panel.waitFor()
      if (label === 'Qualité & critères') {
        for (const horizon of [1, 3, 5, 10]) {
          await page.getByRole('button', { name: `${horizon} ${horizon === 1 ? 'an' : 'ans'}`, exact: true }).click()
          await page.getByText(`ROIC sur ${horizon} ans`, { exact: true }).waitFor()
        }
        await page.getByText('Manquant', { exact: true }).waitFor(); await page.getByText('Échoué', { exact: true }).waitFor()
      }
      if (label === 'Publications') {
        await page.getByText('Résultat semestriel synthétique', { exact: true }).waitFor()
        await page.getByText('Déclarée publiée · preuve non attestée', { exact: true }).waitFor()
        assert.ok((await panel.innerText()).includes('Capex')); assert.ok((await panel.innerText()).includes('BPA dilué'))
      }
      if (label === 'Valorisation') await page.getByText('10 % / 20 %', { exact: true }).waitFor()
      if (label === 'Société & analyses') await page.getByText('Entreprise fictive pour vérifier le parcours de recherche.', { exact: true }).first().waitFor()
      await fit(); await shot(`${label.replace(/[^a-zA-Z]/g, '-')}-${width}`)
    }
    await page.getByRole('tab', { name: 'Cours & régression', exact: true }).click()
    await page.getByRole('button', { name: 'MAX', exact: true }).waitFor()
    for (const horizon of ['5Y', '10Y', 'MAX']) await page.getByRole('button', { name: horizon, exact: true }).click()
    for (const mode of ['EUR', 'Local', 'Lin', 'Log', 'MM200', 'MM200']) await page.getByRole('button', { name: mode, exact: true }).click()
    await page.getByRole('tabpanel').locator('svg path[stroke]').first().waitFor()
    assert.ok((await page.evaluate(() => window.researchQa.reads.filter(read => read.table === 'historical_prices'))).every(read => read.filters.some(([op, key, value]) => op === 'eq' && key === 'ticker' && value === 'ASTER.IT')))
    await fit(); await shot(`regression-${width}`)
    await page.getByRole('button', { name: /Open .*fullscreen/ }).click()
    await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.getByRole('link', { name: 'Retour aux résultats filtrés' }).click()
    assert.equal(new URL(page.url()).searchParams.get('query'), 'Aster')
    assert.equal(new URL(page.url()).searchParams.get('preset'), 'ESN_UNIVERSE')
    assert.ok(listQuery.includes('Aster'))
    for (const key of ['minScore', 'maxPe', 'minYield', 'country', 'sector', 'exchange', 'theme', 'tag', 'state']) assert.equal(new URL(page.url()).searchParams.get(key), new URLSearchParams(listQuery).get(key))
    await page.getByRole('button', { name: 'Top Quality', exact: true }).click()
    await page.getByRole('heading', { name: 'Top Quality non attestée' }).waitFor()
    await page.getByRole('button', { name: 'Voir les qualifications historiques' }).click()
    await page.getByRole('link', { name: 'Aster Systems · classe B', exact: true }).filter({ visible: true }).waitFor()
    await page.getByRole('button', { name: /Réinitialiser/ }).click()
    if (width < 768) {
      assert.equal(await page.locator('#app-navigation').isVisible(), false)
      await page.getByRole('button', { name: 'Ouvrir la navigation' }).click()
      const navigation = page.getByRole('dialog', { name: 'Navigation principale' })
      await navigation.waitFor(); await page.keyboard.press('Shift+Tab')
      assert.ok(await navigation.evaluate(el => el.contains(document.activeElement)))
      await page.keyboard.press('Escape'); assert.equal(await navigation.isVisible(), false)
      assert.equal(await page.getByRole('button', { name: 'Ouvrir la navigation' }).evaluate(el => el === document.activeElement), true)
    }
    await page.getByRole('button', { name: 'Theme toggle' }).click(); await shot(`research-dark-${width}`); await fit()
    await page.getByRole('button', { name: 'Theme toggle' }).click()
    assert.deepEqual(await page.evaluate(() => window.researchQa.mutations), [])
    results.push({ width, flow: 'filters → dossier → 7 sections → regression controls/fullscreen → filtered return → gated Top Quality → historical qualified → responsive navigation → dark mode', status: 'PASS' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  for (const [scenario, expected] of [['partial', 'Lecteur valorisation indisponible.'], ['error', 'Impossible de lire l’univers'], ['empty', 'Univers reçu vide'], ['auth-error', 'Session non vérifiable'], ['signed-out', 'Session déconnectée'], ['conflict', 'Identité contradictoire'], ['duplicate', 'Doublon dans le lecteur valorisation']]) {
    const query = ['conflict', 'duplicate'].includes(scenario) ? '&instrument=fixture%3AASTER%3AA' : ''
    await page.goto(base + '/research?fixture_case=' + scenario + query + '#scenario=' + scenario)
    await page.getByText(expected, { exact: false }).first().waitFor()
    if (scenario === 'conflict') {
      await page.getByRole('tab', { name: 'Cours & régression', exact: true }).click()
      await page.getByText('Identité de prix ambiguë', { exact: false }).waitFor()
      await page.getByRole('tab', { name: 'Publications', exact: true }).click()
      await page.getByText('Identité ambiguë : aucune publication', { exact: false }).waitFor()
      assert.ok((await page.evaluate(() => window.researchQa.reads)).every(read => !['historical_prices', 'equity_reporting_calendar'].includes(read.table)))
    }
    await fit(); await shot(`state-${scenario}`)
    if (['auth-error', 'signed-out'].includes(scenario)) assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
    results.push({ scenario, status: 'PASS' })
  }
  for (const [scenario, tab, expected] of [['criteria-error', 'quality', 'Lecture des critères impossible'], ['publications-error', 'publications', 'Publications indisponibles']]) {
    await page.goto(base + `/research?instrument=fixture%3AASTER%3AA&tab=${tab}#scenario=${scenario}`)
    await page.getByText(expected, { exact: false }).waitFor(); results.push({ scenario, status: 'PASS' })
  }
  for (const scenario of ['partial', 'trident-partial']) {
    await page.goto(base + `/research?fixture_case=${scenario}&instrument=fixture%3AASTER%3AA&tab=history#scenario=${scenario}`)
    await page.getByRole('tabpanel').getByText('Identité de prix ambiguë ou non vérifiable', { exact: false }).waitFor()
    assert.equal((await page.evaluate(() => window.researchQa.reads.filter(read => read.table === 'historical_prices'))).length, 0)
    await shot(`history-${scenario}`); results.push({ scenario: `${scenario}: failed reader hides share class B, history suspended`, status: 'PASS' })
  }
  for (const width of [1440, 390]) for (const side of ['equity', 'trident']) for (const mode of ['conflict', 'duplicate']) {
    const scenario = `symbol-claim-${side}-${mode}`
    await page.setViewportSize({ width, height: 960 })
    await page.goto(base + `/research?fixture_case=${scenario}&instrument=fixture%3AASTER%3AA&tab=history#scenario=${scenario}`)
    assert.ok(page.url().startsWith(base + '/research?'))
    assert.equal(await page.title(), 'ASTROCYTE — recherche, recette locale')
    await page.getByRole('heading', { level: 1, name: 'Aster Systems', exact: true }).waitFor()
    await page.getByRole('tabpanel').getByText('Identité de prix ambiguë ou non vérifiable', { exact: false }).waitFor()
    await page.getByText('Historique suspendu : symbole de cours revendiqué', { exact: false }).first().waitFor()
    await page.getByRole('tab', { name: 'Synthèse', exact: true }).click()
    await page.getByRole('tabpanel').waitFor()
    await page.getByRole('tab', { name: 'Cours & régression', exact: true }).click()
    await page.getByRole('tabpanel').getByText('Identité de prix ambiguë ou non vérifiable', { exact: false }).waitFor()
    assert.equal((await page.evaluate(() => window.researchQa.reads.filter(read => read.table === 'historical_prices'))).length, 0)
    assert.equal(await page.getByRole('tabpanel').locator('svg path[stroke]').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.researchQa.mutations), [])
    await fit(); await shot(`${scenario}-${width}`)
    results.push({ width, scenario: `${scenario}: quarantined claims block wrong-class series before query`, status: 'PASS' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(base + '/research?fixture_case=price-missing&instrument=fixture%3AASTER%3AA&tab=history#scenario=price-missing')
  await page.waitForFunction(() => window.researchQa.reads.some(read => read.table === 'historical_prices'))
  await settleUi()
  assert.ok((await page.evaluate(() => window.researchQa.reads.filter(read => read.table === 'historical_prices'))).every(read => read.filters.some(([, key, value]) => key === 'ticker' && value === 'ASTER.IT')))
  assert.equal(await page.getByRole('tabpanel').locator('svg path[stroke]').count(), 0)
  results.push({ scenario: 'explicit source history absent: no wrong-currency short-ticker fallback', status: 'PASS' })
  await page.goto(base + '/research?fixture_case=auth-error#scenario=auth-error')
  await page.getByText('Session non vérifiable', { exact: false }).waitFor()
  await page.evaluate(() => window.researchQa.emitSession('INITIAL_SESSION', 'offline-owner-a'))
  await settleUi()
  await page.getByText('Session non vérifiable', { exact: false }).waitFor()
  assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
  assert.equal(await page.getByRole('heading', { name: 'Screener & Top Quality' }).count(), 0)
  results.push({ scenario: 'cached INITIAL_SESSION after getUser error stays closed', status: 'PASS' })
  await page.goto(base + '/research?fixture_case=auth-pending#scenario=auth-pending')
  await page.waitForFunction(() => window.researchQa.stats().pendingAuth === 1)
  await page.evaluate(() => window.researchQa.emitSession('INITIAL_SESSION', 'offline-owner-a'))
  await settleUi()
  assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
  await page.evaluate(() => window.researchQa.settleNextAuth('offline-owner-a', true))
  await page.getByText('Session non vérifiable', { exact: false }).waitFor()
  assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
  results.push({ scenario: 'cached INITIAL_SESSION before delayed getUser error cannot open reads', status: 'PASS' })
  await page.evaluate(() => { window.researchQa.configureAuth({ error: false, pending: false }); window.researchQa.emitSession('SIGNED_IN', 'offline-owner-a') })
  await page.getByRole('link', { name: 'Aster Systems', exact: true }).waitFor()
  const readsBeforeRefresh = await page.evaluate(() => window.researchQa.reads.length)
  await page.evaluate(() => { window.researchQa.configureAuth({ error: true }); window.researchQa.emitSession('TOKEN_REFRESHED', 'offline-owner-a') })
  await page.getByText('Session non vérifiable', { exact: false }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Screener & Top Quality' }).count(), 0)
  assert.equal((await page.evaluate(() => window.researchQa.reads)).length, readsBeforeRefresh)
  results.push({ scenario: 'signed-in recovery is verified; failed token refresh closes data cache', status: 'PASS' })
  for (const verified of ['offline-owner-a', 'offline-owner-b']) {
    await page.goto(base + `/research?auth-case=${verified}#scenario=auth-pending`)
    await page.waitForFunction(() => window.researchQa.stats().pendingAuth === 1)
    await page.evaluate(() => window.researchQa.emitSession('SIGNED_IN', 'offline-owner-b'))
    await page.waitForFunction(() => window.researchQa.stats().pendingAuth === 2)
    await page.evaluate(() => window.researchQa.settleNextAuth('offline-owner-a'))
    await settleUi()
    assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
    await page.evaluate(user => window.researchQa.settleNextAuth(user), verified)
    if (verified === 'offline-owner-a') {
      await page.getByText('Session non vérifiable', { exact: false }).waitFor()
      assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
    } else await page.getByRole('link', { name: 'Aster Systems', exact: true }).waitFor()
    results.push({ scenario: `subject change rejects stale verification; verified subject ${verified.endsWith('a') ? 'mismatch stays closed' : 'match opens'}`, status: 'PASS' })
  }
  await page.goto(base + '/research?fixture_case=signout-pending#scenario=auth-pending')
  await page.waitForFunction(() => window.researchQa.stats().pendingAuth === 1)
  await page.evaluate(() => window.researchQa.setSession(null))
  await page.getByText('Session déconnectée', { exact: false }).waitFor()
  await page.evaluate(() => window.researchQa.settleNextAuth('offline-owner-a'))
  await settleUi()
  await page.getByText('Session déconnectée', { exact: false }).waitFor()
  assert.equal((await page.evaluate(() => window.researchQa.reads)).length, 0)
  results.push({ scenario: 'signout cancels delayed verification and keeps all data closed', status: 'PASS' })
  await page.goto(base + '/research?instrument=does-not-exist')
  await page.getByText('Instrument absent des lecteurs', { exact: false }).waitFor(); results.push({ scenario: 'missing-deep-link', status: 'PASS' })
  await page.goto(base + '/research?instrument=fixture%3AASTER%3AA&tab=publications')
  await page.getByText('Résultat semestriel synthétique', { exact: true }).waitFor()
  const before = await page.evaluate(() => window.researchQa.reads.length)
  await page.evaluate(() => window.researchQa.setSession(null))
  await page.getByText('Session déconnectée', { exact: false }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Aster Systems', exact: true }).count(), 0)
  await page.evaluate(() => window.researchQa.setSession('offline-owner-b'))
  await page.getByText('Résultat semestriel synthétique', { exact: true }).waitFor()
  assert.ok(await page.evaluate(previous => window.researchQa.reads.length > previous, before))
  assert.deepEqual(await page.evaluate(() => window.researchQa.mutations), [])
  results.push({ scenario: 'signout/subject-change cache reset (synthetic event)', status: 'PASS' })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report('PASS'), null, 2))
  console.log(JSON.stringify(report('PASS'), null, 2))
} catch (error) {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report('FAIL'), failure: String(error) }, null, 2))
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }

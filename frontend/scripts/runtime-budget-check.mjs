import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), '..')

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function assertCheck(name, ok, detail) {
  if (ok) {
    console.log(`PASS ${name}`)
    return true
  }
  console.error(`FAIL ${name}: ${detail}`)
  return false
}

const trident = read('frontend/app/trident/page.tsx')
const targets = read('frontend/app/targets/page.tsx')
const dashboard = read('frontend/app/page.tsx')
const dataHealth = read('frontend/components/DataHealthPanel.tsx')

const checks = [
  assertCheck(
    'trident.pagination.page_size',
    trident.includes('const TRIDENT_PAGE_SIZE = 100') && trident.includes('pageRows.map'),
    'Trident should render paged rows instead of the full filtered set.'
  ),
  assertCheck(
    'trident.runtime_dom_marker',
    trident.includes('data-trident-row="true"'),
    'Browser smoke needs a stable row marker to enforce DOM budgets.'
  ),
  assertCheck(
    'targets.mobile_cards',
    targets.includes('md:hidden') && targets.includes('hidden md:block') && targets.includes('Portfolio Drift'),
    'Targets should expose mobile cards and keep the table desktop-only.'
  ),
  assertCheck(
    'dashboard.lazy_heavy_surfaces',
    dashboard.includes("import dynamic from 'next/dynamic'") &&
      dashboard.includes("import('../components/GeographicMap')") &&
      dashboard.includes("import('../components/AssetDetailDrawer')") &&
      dashboard.includes("import('../components/DataHealthPanel')"),
    'Dashboard heavy surfaces should be lazy-loaded.'
  ),
  assertCheck(
    'data_operations.action_hints',
    dataHealth.includes('Data Operations') && dataHealth.includes('operationActionForRun') && dataHealth.includes('GITHUB_ACTIONS_URL'),
    'Data panel should expose operational action hints and run links.'
  ),
]

process.exit(checks.every(Boolean) ? 0 : 1)

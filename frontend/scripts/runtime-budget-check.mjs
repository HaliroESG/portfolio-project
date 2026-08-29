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
const screener = read('frontend/app/screener/page.tsx')
const targets = read('frontend/app/targets/page.tsx')
const supports = read('frontend/app/supports/page.tsx')
const dashboard = read('frontend/app/page.tsx')
const familyOfficeData = read('frontend/lib/familyOfficeData.ts')
const familyOfficeHook = read('frontend/lib/useFamilyOfficeBundle.ts')
const ownerIdentityHook = read('frontend/lib/useOwnerIdentity.ts')
const dataHealth = read('frontend/components/DataHealthPanel.tsx')
const publications = read('frontend/app/publications/page.tsx')
const publicationsData = read('frontend/lib/equityPublicationsData.ts')

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
    'open_screener.pagination_dom_marker',
    screener.includes('const PAGE_SIZE = 100') &&
      screener.includes('pageRows.map') &&
      screener.includes('data-equity-screener-row="true"'),
    'Open screener should page large result sets and expose a DOM marker.'
  ),
  assertCheck(
    'targets.mobile_cards',
    targets.includes('md:hidden') && targets.includes('hidden md:block') && targets.includes('Portfolio Drift'),
    'Targets should expose mobile cards and keep the table desktop-only.'
  ),
  assertCheck(
    'supports.pagination',
    supports.includes('const PAGE_SIZE = 100') && supports.includes('pageRows.map') && supports.includes('data-support-row="true"'),
    'Supports should page large support catalogues and expose a DOM marker.'
  ),
  assertCheck(
    'dashboard.family_office_bounded_reads',
    dashboard.includes('useFamilyOfficeBundle()') &&
      familyOfficeHook.includes('useSWR(') &&
      familyOfficeHook.includes('familyOfficeSWRKey(ownerUserId)') &&
      familyOfficeHook.includes('result.data?.ownerUserId === ownerUserId') &&
      ownerIdentityHook.includes('onAuthStateChange') &&
      familyOfficeHook.includes('loadFamilyOfficeBundle(supabase)') &&
      familyOfficeData.includes('const results = await Promise.all([') &&
      familyOfficeData.includes('.limit(1500)') &&
      familyOfficeData.includes('.limit(100)') &&
      familyOfficeData.includes('.limit(36)'),
    'Family Office overview should share its cache and bound historical data reads.'
  ),
  assertCheck(
    'data_operations.action_hints',
    dataHealth.includes('Data Operations') && dataHealth.includes('operationActionForRun') && dataHealth.includes('GITHUB_ACTIONS_URL'),
    'Data panel should expose operational action hints and run links.'
  ),
  assertCheck(
    'publications.pagination',
    publications.includes('const TABLE_PAGE_SIZE = 100') &&
      publications.includes('pageRows') &&
      publicationsData.includes('equity_publication_dashboard_latest'),
    'Publication table should keep the rendered company row set bounded.'
  ),
]

process.exit(checks.every(Boolean) ? 0 : 1)

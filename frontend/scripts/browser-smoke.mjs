import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3001'
const vercelProtectionBypass = process.env.VERCEL_PROTECTION_BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || ''
const baseHost = new URL(baseUrl).host
const routes = ['/', '/trident', '/screener', '/geo', '/fx', '/compare', '/targets', '/arbitrage', '/supports']
const viewports = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 390, height: 844 },
]

function fail(message) {
  throw new Error(message)
}

function isIgnoredConsoleError(entry) {
  return (
    (
      entry.text.includes('Failed to load resource: the server responded with a status of 400') &&
      (entry.url.includes('supabase.co') || entry.url.includes('/_next/static/'))
    ) ||
    (
      entry.text.includes('Failed to load resource: the server responded with a status of 404') &&
      (
        entry.url.includes('portfolio_decision_items_latest') ||
        entry.url.includes('trident_stock_insights') ||
        entry.url.includes('equity_screener_latest') ||
        entry.url.includes('equity_screener_results') ||
        entry.url.includes('broker_position_snapshot_runs') ||
        entry.url.includes('support_sources') ||
        entry.url.includes('support_source_rows') ||
        entry.url.includes('investment_supports') ||
        entry.url.includes('support_availability') ||
        entry.url.includes('target_models') ||
        entry.url.includes('target_buckets') ||
        entry.url.includes('target_envelope_lines') ||
        entry.url.includes('allocation_advice_items_latest')
      )
    )
  )
}

const browser = await chromium.launch()
const results = []

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push({
          text: message.text(),
          url: message.location().url || '',
        })
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    if (vercelProtectionBypass) {
      await page.route('**/*', async (route) => {
        const request = route.request()
        if (new URL(request.url()).host !== baseHost) {
          await route.continue()
          return
        }
        await route.continue({
          headers: {
            ...request.headers(),
            'x-vercel-protection-bypass': vercelProtectionBypass,
          },
        })
      })
      const bypassUrl = new URL('/', baseUrl)
      bypassUrl.searchParams.set('x-vercel-set-bypass-cookie', 'true')
      bypassUrl.searchParams.set('x-vercel-protection-bypass', vercelProtectionBypass)
      await page.goto(bypassUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 })
    }

    for (const route of routes) {
      const url = new URL(route, baseUrl).toString()
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
      const status = response?.status() ?? 0

      const metrics = await page.evaluate(() => {
        const bodyText = document.body.innerText.trim()
        const mainText = (document.querySelector('main')?.innerText.trim() || '').toLowerCase()
        const errorOverlay = document.querySelector('[data-nextjs-dialog-overlay],[data-vite-dev-id]')
        const nextPortal = document.querySelector('nextjs-portal')
        const nextPortalText = nextPortal?.textContent?.trim() || ''
        const authProtected = document.title === 'Authentication Required' || bodyText.includes('This page requires Vercel authentication')
        return {
          title: document.title,
          bodyChars: bodyText.length,
          authProtected,
          hasTridentScreen: mainText.includes('trident screener'),
          hasOpenScreenerScreen: mainText.includes('open screener'),
          hasFrameworkOverlay: Boolean(errorOverlay) || nextPortalText.length > 0,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          tridentRows: document.querySelectorAll('[data-trident-row="true"]').length,
          equityScreenerRows: document.querySelectorAll('[data-equity-screener-row="true"]').length,
        }
      })

      const isProtectedResponse = status === 401 || status === 403 || page.url().includes('/_vercel/sso')
      if (isProtectedResponse || metrics.authProtected) {
        fail(`${viewport.name} ${route}: Vercel deployment protection blocked the browser smoke. Set VERCEL_PROTECTION_BYPASS or disable protection for this test.`)
      }
      if (metrics.bodyChars < 40) fail(`${viewport.name} ${route}: page appears blank.`)
      if (metrics.hasFrameworkOverlay) fail(`${viewport.name} ${route}: framework overlay detected.`)
      if (metrics.scrollWidth > metrics.clientWidth + 2) {
        fail(`${viewport.name} ${route}: horizontal overflow ${metrics.scrollWidth}px for ${metrics.clientWidth}px viewport.`)
      }
      if (route === '/trident' && metrics.tridentRows > 220) {
        fail(`${viewport.name} ${route}: Trident rendered ${metrics.tridentRows} row nodes; budget is 220.`)
      }
      if (route === '/trident' && !metrics.hasTridentScreen) {
        fail(`${viewport.name} ${route}: Trident screen marker missing.`)
      }
      if (route === '/screener' && !metrics.hasOpenScreenerScreen) {
        fail(`${viewport.name} ${route}: Open screener screen marker missing.`)
      }
      if (route === '/screener' && metrics.equityScreenerRows > 220) {
        fail(`${viewport.name} ${route}: Open screener rendered ${metrics.equityScreenerRows} row nodes; budget is 220.`)
      }

      results.push({ route, viewport: viewport.name, ...metrics })
    }

    await page.close()
    const relevantConsoleErrors = consoleErrors.filter((entry) => !isIgnoredConsoleError(entry))
    if (relevantConsoleErrors.length > 0 || pageErrors.length > 0) {
      const sample = [
        ...relevantConsoleErrors.map((entry) => `${entry.text}${entry.url ? ` (${entry.url})` : ''}`),
        ...pageErrors,
      ].slice(0, 5)
      fail(`${viewport.name}: console/page errors: ${sample.join(' | ')}`)
    }
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({ ok: true, baseUrl, results }, null, 2))

import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3001'
const routes = ['/', '/trident', '/geo', '/fx', '/compare', '/targets', '/arbitrage']
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
      (entry.url.includes('portfolio_decision_items_latest') || entry.url.includes('broker_position_snapshot_runs'))
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

    for (const route of routes) {
      const url = new URL(route, baseUrl).toString()
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })

      const metrics = await page.evaluate(() => {
        const bodyText = document.body.innerText.trim()
        const errorOverlay = document.querySelector('[data-nextjs-dialog-overlay],[data-vite-dev-id]')
        const nextPortal = document.querySelector('nextjs-portal')
        const nextPortalText = nextPortal?.textContent?.trim() || ''
        return {
          title: document.title,
          bodyChars: bodyText.length,
          hasFrameworkOverlay: Boolean(errorOverlay) || nextPortalText.length > 0,
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          tridentRows: document.querySelectorAll('[data-trident-row="true"]').length,
        }
      })

      if (metrics.bodyChars < 40) fail(`${viewport.name} ${route}: page appears blank.`)
      if (metrics.hasFrameworkOverlay) fail(`${viewport.name} ${route}: framework overlay detected.`)
      if (metrics.scrollWidth > metrics.clientWidth + 2) {
        fail(`${viewport.name} ${route}: horizontal overflow ${metrics.scrollWidth}px for ${metrics.clientWidth}px viewport.`)
      }
      if (route === '/trident' && metrics.tridentRows > 220) {
        fail(`${viewport.name} ${route}: Trident rendered ${metrics.tridentRows} row nodes; budget is 220.`)
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

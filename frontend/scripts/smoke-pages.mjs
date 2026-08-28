import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pages = ['app/page.tsx', 'app/geo/page.tsx', 'app/fx/page.tsx', 'app/publications/page.tsx']
for (const rel of pages) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    console.error(`missing page: ${rel}`)
    process.exit(1)
  }
  const txt = fs.readFileSync(full, 'utf8')
  if (
    !txt.includes('dataStateLabel')
    && !txt.includes('stateLabel(')
    && !txt.includes('FamilyOfficeStateBadge')
    && !txt.includes('StateBadge')
  ) {
    console.error(`no explicit data-state indicator found in: ${rel}`)
    process.exit(1)
  }
}
console.log('frontend smoke pages: PASS')

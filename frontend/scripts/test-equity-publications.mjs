import assert from 'node:assert/strict'

const ui = await import('../lib/equityPublicationUi.ts')

assert.equal(ui.publicationDate('2026-07-30').getDate(), 30)
assert.equal(ui.publicationDateKey(new Date(2026, 6, 30)), '2026-07-30')

const june2026 = ui.publicationMonthGrid(new Date(2026, 5, 1))
assert.equal(june2026.length, 35)
assert.equal(june2026[0]?.getDate(), 1)
assert.equal(june2026[29]?.getDate(), 30)

const august2026 = ui.publicationMonthGrid(new Date(2026, 7, 1))
assert.equal(august2026.length, 42)
assert.equal(august2026.slice(0, 5).every((value) => value === null), true)

assert.equal(ui.matchesPublicationSearch(['LVMH', 'Moët Hennessy Louis Vuitton'], 'lvmh'), true)
assert.equal(ui.matchesPublicationSearch(['Apple Inc.', 'AAPL'], 'aapl'), true)
assert.equal(ui.matchesPublicationSearch(['Apple Inc.', 'AAPL'], 'total'), false)

console.log('equity publication UI tests: PASS')

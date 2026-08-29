import assert from 'node:assert/strict'

const panelWidth = await import('../lib/panelWidth.ts')

assert.equal(panelWidth.clampPanelWidth(200, panelWidth.TRIDENT_DETAIL_WIDTH), 380)
assert.equal(panelWidth.clampPanelWidth(800, panelWidth.TRIDENT_DETAIL_WIDTH), 720)
assert.equal(panelWidth.clampPanelWidth(500, panelWidth.TRIDENT_DETAIL_WIDTH), 500)
assert.equal(panelWidth.clampPanelWidth('bad', panelWidth.TRIDENT_DETAIL_WIDTH), 420)

const backing = new Map()
const storage = {
  getItem(key) {
    return backing.has(key) ? backing.get(key) : null
  },
  setItem(key, value) {
    backing.set(key, value)
  },
}

assert.equal(panelWidth.readStoredPanelWidth(storage, panelWidth.ASSET_DRAWER_WIDTH), 672)
backing.set(panelWidth.ASSET_DRAWER_WIDTH.key, '1200')
assert.equal(panelWidth.readStoredPanelWidth(storage, panelWidth.ASSET_DRAWER_WIDTH), 960)
backing.set(panelWidth.ASSET_DRAWER_WIDTH.key, '620')
assert.equal(panelWidth.readStoredPanelWidth(storage, panelWidth.ASSET_DRAWER_WIDTH), 620)
assert.equal(panelWidth.writeStoredPanelWidth(storage, panelWidth.ASSET_DRAWER_WIDTH, 100), 560)
assert.equal(backing.get(panelWidth.ASSET_DRAWER_WIDTH.key), '560')

const throwingStorage = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
}
assert.equal(panelWidth.readStoredPanelWidth(throwingStorage, panelWidth.TRIDENT_DETAIL_WIDTH), 420)
assert.equal(panelWidth.writeStoredPanelWidth(throwingStorage, panelWidth.TRIDENT_DETAIL_WIDTH, 600), 600)

console.log('frontend panel-width tests: PASS')

import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { useOwnerScopedRows } from '../lib/useOwnerScopedRows.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let controls = null
const rowsByOwner = {
  'owner-a': [{ id: 'order-a', owner_user_id: 'owner-a' }],
  'owner-b': [{ id: 'order-b', owner_user_id: 'owner-b' }],
}

async function loadRows(ownerUserId) {
  return rowsByOwner[ownerUserId] ?? []
}

function Probe({ ownerUserId, loader = loadRows }) {
  controls = useOwnerScopedRows(ownerUserId, loader)
  return React.createElement(
    'div',
    { 'data-owner': ownerUserId },
    controls.rows.map((row) => React.createElement('span', { key: row.id }, row.id)),
  )
}

let renderer
await act(async () => {
  renderer = create(React.createElement(Probe, { ownerUserId: 'owner-a' }))
})
await act(async () => {
  await controls.load()
})
assert.match(JSON.stringify(renderer.toJSON()), /order-a/)

await act(async () => {
  renderer.update(React.createElement(Probe, { ownerUserId: 'owner-b' }))
})
assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /order-a/)
assert.equal(controls.loaded, false)

await act(async () => {
  await controls.load()
})
assert.match(JSON.stringify(renderer.toJSON()), /order-b/)
assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /order-a/)

let resolveOwnerA
const delayedLoader = (ownerUserId) => {
  if (ownerUserId === 'owner-a') {
    return new Promise((resolve) => { resolveOwnerA = resolve })
  }
  return Promise.resolve(rowsByOwner[ownerUserId] ?? [])
}

await act(async () => {
  renderer.update(React.createElement(Probe, { ownerUserId: 'owner-a', loader: delayedLoader }))
})
let ownerALoad
await act(async () => {
  ownerALoad = controls.load()
})
await act(async () => {
  renderer.update(React.createElement(Probe, { ownerUserId: 'owner-b', loader: delayedLoader }))
})
await act(async () => {
  resolveOwnerA(rowsByOwner['owner-a'])
  await ownerALoad
})
assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /order-a/)

await act(async () => {
  renderer.unmount()
})

console.log('mounted owner A -> B transition and stale request suppression: PASS')

import assert from 'node:assert/strict'
import React from 'react'
import { act, create } from 'react-test-renderer'
import { SWRConfig } from 'swr'
import { useOwnerBoundState } from '../lib/useOwnerBoundState.ts'
import { useOwnerScopedRows } from '../lib/useOwnerScopedRows.ts'
import { useOwnerScopedSWR } from '../lib/useOwnerScopedSWR.ts'

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

const privateSurfaces = [
  'targets',
  'arbitrage',
  'governance-widget',
  'data-health-panel',
  'geo-portfolio-aggregation',
]

function SurfaceProbe({ ownerUserId, surface, loader }) {
  const [privateFilter, setPrivateFilter] = useOwnerBoundState(ownerUserId, 'DEFAULT')
  surfaceControls.set(surface, { setPrivateFilter })
  const result = useOwnerScopedSWR(
    ownerUserId,
    surface,
    [],
    loader,
    { dedupingInterval: 0, revalidateOnFocus: false },
  )
  return React.createElement(
    'div',
    { 'data-owner': ownerUserId, 'data-surface': surface },
    React.createElement('span', { key: 'private-filter' }, privateFilter),
    result.data?.map((row) => React.createElement('span', { key: row.id }, row.id)) ?? [],
  )
}

const surfaceControls = new Map()

for (const surface of privateSurfaces) {
  let resolveA
  const requests = []
  const loader = (ownerUserId) => {
    requests.push(ownerUserId)
    if (ownerUserId === 'owner-a') {
      return new Promise((resolve) => { resolveA = resolve })
    }
    return Promise.resolve([{ id: `${surface}-owner-b`, owner_user_id: 'owner-b' }])
  }
  const renderProbe = (ownerUserId) => React.createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    React.createElement(SurfaceProbe, { ownerUserId, surface, loader }),
  )

  let surfaceRenderer
  await act(async () => {
    surfaceRenderer = create(renderProbe('owner-a'))
  })
  assert.deepEqual(requests, ['owner-a'])
  await act(async () => {
    surfaceControls.get(surface).setPrivateFilter(`${surface}-owner-a-filter`)
  })
  assert.match(JSON.stringify(surfaceRenderer.toJSON()), new RegExp(`${surface}-owner-a-filter`))

  await act(async () => {
    surfaceRenderer.update(renderProbe('owner-b'))
  })
  assert.doesNotMatch(JSON.stringify(surfaceRenderer.toJSON()), /owner-a/)
  assert.match(JSON.stringify(surfaceRenderer.toJSON()), /DEFAULT/)

  await act(async () => {})
  assert.match(JSON.stringify(surfaceRenderer.toJSON()), new RegExp(`${surface}-owner-b`))

  await act(async () => {
    resolveA([{ id: `${surface}-owner-a`, owner_user_id: 'owner-a' }])
  })
  assert.doesNotMatch(JSON.stringify(surfaceRenderer.toJSON()), new RegExp(`${surface}-owner-a`))
  assert.match(JSON.stringify(surfaceRenderer.toJSON()), new RegExp(`${surface}-owner-b`))
  assert.deepEqual(requests, ['owner-a', 'owner-b'])

  await act(async () => {
    surfaceRenderer.unmount()
  })
}

console.log('mounted A -> B transition for Targets, Arbitrage, Governance, DataHealth and Geo: PASS')

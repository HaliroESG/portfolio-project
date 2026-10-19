import React, { lazy, Suspense } from 'react'
export default function dynamic(loader, options = {}) {
  const Lazy = lazy(async () => ({ default: await loader() }))
  return function OfflineDynamic(props) { const Loading = options.loading; return <Suspense fallback={Loading ? <Loading /> : null}><Lazy {...props} /></Suspense> }
}

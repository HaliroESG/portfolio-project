import { Suspense } from 'react'
import CompareClient from './CompareClient'

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#080A0F] text-sm font-mono text-slate-500 dark:text-gray-400">
          Loading compare...
        </div>
      }
    >
      <CompareClient />
    </Suspense>
  )
}

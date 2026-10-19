import React, { useMemo, useSyncExternalStore } from 'react'
const subscribe = notify => { window.addEventListener('popstate', notify); return () => window.removeEventListener('popstate', notify) }
const snapshot = () => window.location.href
const change = (href, replace = false) => { window.history[replace ? 'replaceState' : 'pushState']({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')) }
export function usePathname() { return new URL(useSyncExternalStore(subscribe, snapshot)).pathname }
export function useSearchParams() { const href = useSyncExternalStore(subscribe, snapshot); return useMemo(() => new URL(href).searchParams, [href]) }
export function useRouter() { return { push: href => change(href), replace: href => change(href, true), refresh: () => {}, back: () => window.history.back() } }
export default function Link({ href, children, onClick, ...props }) {
  return <a {...props} href={href} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    if (typeof href === 'string' && href.startsWith('/')) { event.preventDefault(); change(href) }
  }}>{children}</a>
}

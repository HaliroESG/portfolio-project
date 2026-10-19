export function isNavigationActive(pathname: string, search: string, href: string): boolean {
  const [path, query] = href.split('?')
  if (pathname !== path && !(path !== '/' && pathname.startsWith(`${path}/`))) return false
  if (path === '/operations') return new URLSearchParams(search).get('view') === 'closes' ? query === 'view=closes' : !query
  return true
}

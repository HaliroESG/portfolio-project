export function classifyAuthRedirect(currentUrl, requestedRoute, hasLoginScreen) {
  const url = new URL(currentUrl)
  if (url.pathname !== '/login') {
    return { detected: false, valid: false, reason: 'not redirected to /login' }
  }

  const nextRoute = url.searchParams.get('next')
  if (nextRoute !== requestedRoute) {
    return {
      detected: true,
      valid: false,
      reason: `unexpected next route ${JSON.stringify(nextRoute)}`,
    }
  }

  if (!hasLoginScreen) {
    return { detected: true, valid: false, reason: 'login page marker missing' }
  }

  return { detected: true, valid: true, reason: 'expected authentication redirect' }
}

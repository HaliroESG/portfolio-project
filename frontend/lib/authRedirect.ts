function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function parseTrustedOrigin(value: string | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    const usesAllowedProtocol =
      url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname))
    const isBareOrigin =
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash

    return usesAllowedProtocol && isBareOrigin ? url.origin : null
  } catch {
    return null
  }
}

export function resolveAuthRedirectOrigin(
  requestUrl: string,
  configuredOrigin = process.env.APP_ORIGIN,
) {
  return parseTrustedOrigin(configuredOrigin) ?? new URL(requestUrl).origin
}

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
  configuredOrigin: string | undefined,
) {
  if (configuredOrigin === undefined) return new URL(requestUrl).origin

  const trustedOrigin = parseTrustedOrigin(configuredOrigin)
  if (!trustedOrigin) {
    throw new Error('APP_ORIGIN must be a bare HTTPS origin or a loopback HTTP origin')
  }

  return trustedOrigin
}

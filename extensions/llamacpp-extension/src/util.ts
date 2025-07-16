// Zustand proxy state structure
interface ProxyState {
  proxyEnabled: boolean
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  proxyIgnoreSSL: boolean
  verifyProxySSL: boolean
  verifyProxyHostSSL: boolean
  verifyPeerSSL: boolean
  verifyHostSSL: boolean
  noProxy: string
}

export function getProxyConfig(): Record<
  string,
  string | string[] | boolean
> | null {
  try {
    // Retrieve proxy configuration from localStorage
    const proxyConfigString = localStorage.getItem('setting-proxy-config')
    if (!proxyConfigString) {
      return null
    }

    const proxyConfigData = JSON.parse(proxyConfigString)
    const proxyState: ProxyState = proxyConfigData.state

    // Only return proxy config if proxy is enabled
    if (!proxyState.proxyEnabled || !proxyState.proxyUrl) {
      return null
    }

    const proxyConfig: Record<string, string | string[] | boolean> = {
      url: proxyState.proxyUrl,
    }

    // Add username/password if both are provided
    if (proxyState.proxyUsername && proxyState.proxyPassword) {
      proxyConfig.username = proxyState.proxyUsername
      proxyConfig.password = proxyState.proxyPassword
    }

    // Parse no_proxy list if provided
    if (proxyState.noProxy) {
      const noProxyList = proxyState.noProxy
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)

      if (noProxyList.length > 0) {
        proxyConfig.no_proxy = noProxyList
      }
    }

    // Add SSL verification settings
    proxyConfig.ignore_ssl = proxyState.proxyIgnoreSSL
    proxyConfig.verify_proxy_ssl = proxyState.verifyProxySSL
    proxyConfig.verify_proxy_host_ssl = proxyState.verifyProxyHostSSL
    proxyConfig.verify_peer_ssl = proxyState.verifyPeerSSL
    proxyConfig.verify_host_ssl = proxyState.verifyHostSSL

    return proxyConfig
  } catch (error) {
    console.error('Failed to parse proxy configuration:', error)
    return null
  }
}

/**
 * True when `url` points at a device on the local network: a private IPv4
 * range, a link-local address, or a `.local` mDNS name. Loopback is excluded
 * because macOS does not gate it.
 */
export function isLocalNetworkUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host.endsWith('.local')) return true

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

/**
 * Extra advice for a failed connection to `url`, or '' when it does not apply.
 *
 * macOS blocks an app from reaching devices on the local network until the
 * user allows it under Privacy & Security > Local Network. Until then a
 * request just fails to connect, which looks like a wrong address, even
 * though `curl` from a terminal to the same host works.
 */
export function localNetworkHint(url: string, onMac: boolean): string {
  if (!onMac || !isLocalNetworkUrl(url)) return ''
  return 'If the server is on your local network, allow Jan in System Settings > Privacy & Security > Local Network.'
}

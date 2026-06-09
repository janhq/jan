const KNOWN_PROTOCOLS = new Set([
  'http',
  'https',
  'ftp',
  'file',
  'about',
  'data',
  'mailto',
])
const HOST_PATTERN = /^(?:localhost|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/.*)?$/i

function hasExplicitProtocol(input: string): boolean {
  const match = input.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):(.*)$/)
  if (!match) return false

  const scheme = match[1].toLowerCase()
  if (KNOWN_PROTOCOLS.has(scheme)) {
    return true
  }

  // Treat host:port inputs like localhost:3000 as bare hosts, not schemes.
  return !/^\d/.test(match[2])
}

export function normalizeBrowserAddress(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed || trimmed === 'https://' || trimmed === 'http://') {
    return null
  }

  if (hasExplicitProtocol(trimmed)) {
    try {
      return new URL(trimmed).toString()
    } catch {
      return null
    }
  }

  if (HOST_PATTERN.test(trimmed)) {
    return `https://${trimmed}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

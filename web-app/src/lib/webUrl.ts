/** Display host for a URL, e.g. "https://www.rust-lang.org/x" -> "rust-lang.org". */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const faviconForUrl = (url: string): string =>
  `https://www.google.com/s2/favicons?domain=${hostOf(url)}&sz=64`

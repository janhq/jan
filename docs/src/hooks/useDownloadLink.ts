import { useEffect, useState } from 'react'

import axios from 'axios'

// The releases page — used as the initial value and as the fallback when the
// latest-release lookup fails, so the button always works.
const RELEASES_PAGE = 'https://github.com/janhq/jan/releases/latest'

// Mirrors DropdownDownload's per-OS asset mapping: Mac gets the universal dmg,
// Windows the x64 installer, Linux goes to Flathub (same default as the hero).
const assetHref = (userAgent: string, tagName: string): string => {
  const version = tagName.startsWith('v') ? tagName.slice(1) : tagName
  const base = `https://github.com/janhq/jan/releases/download/${tagName}`

  if (userAgent.includes('Windows')) {
    return `${base}/Jan_${version}_x64-setup.exe`
  }
  if (userAgent.includes('Mac')) {
    return `${base}/Jan_${version}_universal.dmg`
  }
  if (userAgent.includes('Linux')) {
    return 'https://flathub.org/apps/ai.jan.Jan'
  }
  // Unknown OS: default to the Windows installer, matching the hero.
  return `${base}/Jan_${version}_x64-setup.exe`
}

// Cache the tag across mounts so navigating the site doesn't refetch the release
// (and keeps us well under GitHub's unauthenticated rate limit).
let cachedTag: string | null = null

// Resolves the direct, OS-specific download link for the latest Jan release.
// Detects the OS in the browser and points straight at the matching asset,
// falling back to the releases page until (or unless) the lookup resolves.
export const useDownloadLink = (): string => {
  const [href, setHref] = useState(RELEASES_PAGE)

  useEffect(() => {
    let cancelled = false

    const resolve = (tag: string) => {
      if (!cancelled) setHref(assetHref(navigator.userAgent, tag))
    }

    if (cachedTag) {
      resolve(cachedTag)
      return
    }

    axios
      .get<{ tag_name: string }>(
        'https://api.github.com/repos/janhq/jan/releases/latest'
      )
      .then(({ data }) => {
        if (data?.tag_name) {
          cachedTag = data.tag_name
          resolve(data.tag_name)
        }
      })
      .catch(() => {
        // Keep the releases-page fallback already in state.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return href
}

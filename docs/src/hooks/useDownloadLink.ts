import { useEffect, useState } from 'react'

import axios from 'axios'

import { isWindowsArm } from '@/utils/platform'

// The releases page — used as the initial value and as the fallback when the
// latest-release lookup fails, so the button always works.
const RELEASES_PAGE = 'https://github.com/janhq/jan/releases/latest'

// Mirrors DropdownDownload's per-OS asset mapping: Mac gets the universal dmg,
// Windows the x64 or ARM64 installer, Linux goes to Flathub (same default as
// the hero).
const assetHref = (
  userAgent: string,
  release: LatestRelease,
  windowsArm: boolean
): string => {
  const tagName = release.tag_name
  const version = tagName.startsWith('v') ? tagName.slice(1) : tagName
  const base = `https://github.com/janhq/jan/releases/download/${tagName}`

  if (userAgent.includes('Windows')) {
    // Only point at the ARM64 installer when this release ships one; the x64
    // build still runs on Windows on ARM under emulation.
    const armFile = `Jan_${version}_arm64-setup.exe`
    if (windowsArm && release.assets?.some((a) => a.name === armFile)) {
      return `${base}/${armFile}`
    }
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

type LatestRelease = { tag_name: string; assets?: { name: string }[] }

// Cache the release across mounts so navigating the site doesn't refetch it
// (and keeps us well under GitHub's unauthenticated rate limit).
let cachedRelease: LatestRelease | null = null

// Resolves the direct, OS-specific download link for the latest Jan release.
// Detects the OS in the browser and points straight at the matching asset,
// falling back to the releases page until (or unless) the lookup resolves.
export const useDownloadLink = (): string => {
  const [href, setHref] = useState(RELEASES_PAGE)

  useEffect(() => {
    let cancelled = false

    const resolve = async (release: LatestRelease) => {
      const windowsArm = await isWindowsArm()
      if (!cancelled)
        setHref(assetHref(navigator.userAgent, release, windowsArm))
    }

    if (cachedRelease) {
      resolve(cachedRelease)
      return () => {
        cancelled = true
      }
    }

    axios
      .get<LatestRelease>(
        'https://api.github.com/repos/janhq/jan/releases/latest'
      )
      .then(({ data }) => {
        if (data?.tag_name) {
          cachedRelease = data
          resolve(data)
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

'use client'
import { useEffect, useState } from 'react'
import { isWindowsArm } from '@/lib/platform'

// Ported from the old site's useDownloadLink (axios dropped for fetch).
const RELEASES_PAGE = 'https://github.com/janhq/jan/releases/latest'

type LatestRelease = { tag_name: string; assets?: { name: string }[] }

const assetHref = (
  userAgent: string,
  release: LatestRelease,
  windowsArm: boolean
): string => {
  const tagName = release.tag_name
  const version = tagName.startsWith('v') ? tagName.slice(1) : tagName
  const base = `https://github.com/janhq/jan/releases/download/${tagName}`

  if (userAgent.includes('Windows')) {
    const armFile = `Jan_${version}_arm64-setup.exe`
    if (windowsArm && release.assets?.some((a) => a.name === armFile)) {
      return `${base}/${armFile}`
    }
    return `${base}/Jan_${version}_x64-setup.exe`
  }
  if (userAgent.includes('Mac')) return `${base}/Jan_${version}_universal.dmg`
  if (userAgent.includes('Linux')) return 'https://flathub.org/apps/ai.jan.Jan'
  return `${base}/Jan_${version}_x64-setup.exe`
}

let cachedRelease: LatestRelease | null = null

export const useDownloadLink = (): string => {
  const [href, setHref] = useState(RELEASES_PAGE)

  useEffect(() => {
    let cancelled = false
    const resolve = async (release: LatestRelease) => {
      const windowsArm = await isWindowsArm()
      if (!cancelled) setHref(assetHref(navigator.userAgent, release, windowsArm))
    }

    if (cachedRelease) {
      resolve(cachedRelease)
    } else {
      fetch('https://api.github.com/repos/janhq/jan/releases/latest')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LatestRelease | null) => {
          if (data?.tag_name) {
            cachedRelease = data
            resolve(data)
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [])

  return href
}

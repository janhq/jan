/* eslint-disable @typescript-eslint/no-explicit-any */
// stores/useReleaseStore.ts
import { create } from 'zustand'

type Release = {
  tag_name: string
  prerelease: boolean
  draft: boolean
  [key: string]: any
}

type ReleaseState = {
  release: Release | null
  loading: boolean
  error: string | null
  fetchLatestRelease: (includeBeta: boolean) => Promise<void>
}

export const useReleaseNotes = create<ReleaseState>((set) => ({
  release: null,
  loading: false,
  error: null,

  fetchLatestRelease: async (includeBeta: boolean) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(
        'https://api.github.com/repos/janhq/jan/releases'
      )
      if (!res.ok) throw new Error('Failed to fetch releases')
      const releases = await res.json()

      const stableRelease = releases.find(
        (release: { prerelease: boolean; draft: boolean }) =>
          !release.prerelease && !release.draft
      )
      const betaRelease = releases.find(
        (release: { prerelease: boolean }) => release.prerelease
      )

      const selected = includeBeta
        ? (betaRelease ?? stableRelease)
        : stableRelease
      set({ release: selected, loading: false })
    } catch (err: any) {
      set({ error: err.message, loading: false })
    }
  },
}))

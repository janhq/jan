/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

type Release = {
  tag_name: string
  prerelease: boolean
  draft: boolean
  body?: string
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
      const releases = await invoke<
        Array<{
          tag_name: string
          prerelease: boolean
          draft: boolean
          body?: string
        }>
      >('fetch_github_releases')

      const stableRelease = releases.find(
        (release) => !release.prerelease && !release.draft
      )
      const betaRelease = releases.find(
        (release) => release.prerelease
      )

      const selected = includeBeta
        ? (betaRelease ?? stableRelease)
        : stableRelease
      set({ release: selected || null, loading: false })
    } catch (err: any) {
      set({ error: err.message || String(err), loading: false })
    }
  },
}))

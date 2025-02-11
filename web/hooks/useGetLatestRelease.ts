/* eslint-disable @typescript-eslint/no-explicit-any */
import useSWR from 'swr'

const fetchLatestRelease = async (includeBeta: boolean) => {
  const res = await fetch('https://api.github.com/repos/janhq/jan/releases')
  if (!res.ok) throw new Error('Failed to fetch releases')

  const releases = await res.json()

  // Filter stable and beta releases
  const stableRelease = releases.find(
    (release: { prerelease: any; draft: any }) =>
      !release.prerelease && !release.draft
  )
  const betaRelease = releases.find(
    (release: { prerelease: any }) => release.prerelease
  )

  return includeBeta ? (betaRelease ?? stableRelease) : stableRelease
}

export function useGetLatestRelease(includeBeta = false) {
  const { data, error, mutate } = useSWR(
    ['latestRelease', includeBeta],
    () => fetchLatestRelease(includeBeta),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  )

  return { release: data, error, mutate }
}

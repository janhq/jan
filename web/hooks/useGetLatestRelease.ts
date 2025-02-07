import useSWR from 'swr'

const fetchLatestRelease = async () => {
  const res = await fetch(
    'https://api.github.com/repos/janhq/jan/releases/latest'
  )
  if (!res.ok) throw new Error('Failed to fetch latest release')
  return res.json()
}

export function useGetLatestRelease() {
  const { data, error, mutate } = useSWR('latestRelease', fetchLatestRelease, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  })

  return { release: data, error, mutate }
}

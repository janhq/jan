import { useEffect, useState } from 'react'

import axios, { isAxiosError } from 'axios'

// Fetches the live GitHub star count in the browser. The build-time value from
// getStaticProps is unreliable (GitHub's unauthenticated API is rate-limited to
// 60 req/hour/IP, so CI builds often fall back to a placeholder). Fetching per
// visitor keeps the number correct and current on prod. `initial` seeds the
// first paint until the request resolves.
export const useGitHubStars = (initial = 0) => {
  const [stars, setStars] = useState<number>(initial)

  useEffect(() => {
    const updateStars = async () => {
      try {
        const { data } = await axios.get<{ stargazers_count: number }>(
          'https://api.github.com/repos/janhq/jan'
        )
        if (typeof data.stargazers_count === 'number') {
          setStars(data.stargazers_count)
        }
      } catch (error) {
        if (isAxiosError(error)) {
          console.error('Failed to get GitHub stars:', error)
        }
      }
    }
    updateStars()
  }, [])

  return { stars }
}

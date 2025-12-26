import { useState, useEffect } from 'react'
import { isJanMediaUrl, resolveJanMediaUrl } from '@/services/media-upload-service'

/**
 * Hook to resolve Jan media URLs to displayable presigned URLs
 * Handles loading state and error handling
 *
 * @param url - The URL to resolve (can be jan media URL or regular URL)
 * @returns Object with displayUrl, isLoading state
 */
export function useResolvedMediaUrl(url: string | undefined) {
  const [displayUrl, setDisplayUrl] = useState<string | undefined>(url)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!url) {
      setDisplayUrl(undefined)
      return
    }

    // If it's a jan media URL, resolve it to presigned URL
    if (isJanMediaUrl(url)) {
      setIsLoading(true)
      resolveJanMediaUrl(url)
        .then(setDisplayUrl)
        .catch((err) => {
          console.error('Failed to resolve jan media URL:', err)
          setDisplayUrl(undefined)
        })
        .finally(() => setIsLoading(false))
    } else {
      // Regular URL - use directly
      setDisplayUrl(url)
      setIsLoading(false)
    }
  }, [url])

  return { displayUrl, isLoading }
}

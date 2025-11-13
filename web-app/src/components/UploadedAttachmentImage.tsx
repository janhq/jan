/**
 * UploadedAttachmentImage Component
 * Automatically resolves jan_id placeholders to presigned URLs for display
 */

import { useEffect, useState } from 'react'
import { mediaService } from '@jan/extensions-web'
import { cn } from '@/lib/utils'

interface UploadedAttachmentImageProps {
  src: string
  alt?: string
  className?: string
}

export function UploadedAttachmentImage({
  src,
  alt = 'Uploaded attachment',
  className = 'size-40 rounded-md object-cover border border-main-view-fg/10',
}: UploadedAttachmentImageProps) {
  const [imageSrc, setImageSrc] = useState(src)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function resolveImage() {
      // Check if src contains jan_id placeholder
      if (mediaService.hasJanIdPlaceholder(src)) {
        setLoading(true)
        try {
          console.log('Resolving jan_id placeholder:', src)
          // Resolve jan_id to presigned URL with caching
          const resolvedUrl = await mediaService.resolveImageSrc(src)
          console.log('Resolved to:', resolvedUrl)
          setImageSrc(resolvedUrl)
        } catch (err) {
          console.error('Failed to resolve image:', err)
          setError(true)
        } finally {
          setLoading(false)
        }
      } else {
        // Regular URL, use as-is
        setImageSrc(src)
      }
    }

    resolveImage()
  }, [src])

  if (loading) {
    return (
      <div className={cn('animate-pulse bg-gray-200 dark:bg-gray-700', className)}>
        <div className="h-full w-full flex items-center justify-center text-xs text-gray-400">
          Loading...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('bg-gray-100 dark:bg-gray-800 flex items-center justify-center', className)}>
        <div className="text-xs text-gray-400">Failed to load image</div>
      </div>
    )
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      onError={() => {
        console.error('Image failed to load:', imageSrc)
        setError(true)
      }}
    />
  )
}

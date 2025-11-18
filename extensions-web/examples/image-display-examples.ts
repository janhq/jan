/**
 * Image Display with jan_id Resolution Examples
 * How to display uploaded images by resolving jan_id placeholders
 */

import { mediaService } from '@jan/extensions-web'

// ============================================================================
// Use Case: Display Uploaded Attachment Image
// ============================================================================

/**
 * Example 1: Resolve single image src with jan_id placeholder
 * 
 * Given: <img src="data:image/jpeg;jan_01k9ycv6vz6gyb591axgsy9man">
 * Result: <img src="https://s3.amazonaws.com/...?presigned=...">
 */
async function displayUploadedImage(imgElement: HTMLImageElement) {
  const originalSrc = imgElement.src
  // e.g., "data:image/jpeg;jan_01k9ycv6vz6gyb591axgsy9man"
  
  console.log('Original src:', originalSrc)
  
  // Check if src contains jan_id placeholder
  if (mediaService.hasJanIdPlaceholder(originalSrc)) {
    console.log('Found jan_id placeholder, resolving...')
    
    // Resolve to presigned URL
    const presignedUrl = await mediaService.resolveImageSrc(originalSrc)
    
    console.log('Resolved URL:', presignedUrl)
    
    // Update img element
    imgElement.src = presignedUrl
    
    return presignedUrl
  }
  
  console.log('No jan_id placeholder found')
  return originalSrc
}

/**
 * Example 2: Extract jan_id and get presigned URL separately
 */
async function extractAndResolve(imageSrc: string) {
  // Extract jan_id from src
  const janId = mediaService.extractJanId(imageSrc)
  // Returns: "jan_01k9ycv6vz6gyb591axgsy9man"
  
  if (!janId) {
    console.log('No jan_id found in:', imageSrc)
    return imageSrc
  }
  
  console.log('Extracted jan_id:', janId)
  
  // Get presigned URL
  const presigned = await mediaService.getPresignedUrl(janId)
  
  console.log('Presigned URL:', presigned.url)
  console.log('Expires in:', presigned.expires_in, 'seconds')
  
  return presigned.url
}

/**
 * Example 3: Resolve images with caching (better performance)
 */
async function displayWithCaching(imgElement: HTMLImageElement) {
  const originalSrc = imgElement.src
  const janId = mediaService.extractJanId(originalSrc)
  
  if (!janId) {
    return
  }
  
  // Use cached presigned URL if available
  const cachedUrl = await mediaService.getPresignedUrlCached(janId)
  imgElement.src = cachedUrl
  
  console.log('Image loaded from cache or fresh:', cachedUrl.substring(0, 50) + '...')
}

/**
 * Example 4: Auto-resolve all images in a container
 */
async function resolveAllImages(containerId: string) {
  const container = document.getElementById(containerId)
  if (!container) return
  
  const images = container.querySelectorAll('img')
  
  console.log(`Found ${images.length} images`)
  
  for (const img of images) {
    if (mediaService.hasJanIdPlaceholder(img.src)) {
      console.log('Resolving image:', img.alt || img.src.substring(0, 50))
      
      const resolvedSrc = await mediaService.resolveImageSrc(img.src)
      img.src = resolvedSrc
    }
  }
  
  console.log('All images resolved!')
}

/**
 * Example 5: Resolve images in HTML content (for rendered messages)
 */
async function resolveHtmlContent(htmlContent: string) {
  // Example HTML with jan_id placeholders:
  // <img alt="Uploaded attachment" src="data:image/jpeg;jan_01k9ycv6vz6gyb591axgsy9man">
  // <img src="data:image/png;jan_abc123xyz">
  
  const resolvedHtml = await mediaService.resolveHtmlImages(htmlContent)
  
  // Result: All img src attributes with jan_ids are replaced with presigned URLs
  return resolvedHtml
}

// ============================================================================
// React/Vue Component Examples
// ============================================================================

/**
 * Example 6: React component to display uploaded image
 */
/*
import { useEffect, useState } from 'react'
import { mediaService } from '@jan/extensions-web'

function UploadedImage({ src, alt }: { src: string; alt: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function resolve() {
      if (mediaService.hasJanIdPlaceholder(src)) {
        setLoading(true)
        try {
          const url = await mediaService.resolveImageSrc(src)
          setResolvedSrc(url)
        } catch (error) {
          console.error('Failed to resolve image:', error)
        } finally {
          setLoading(false)
        }
      }
    }
    resolve()
  }, [src])

  if (loading) {
    return <div className="loading-spinner">Loading image...</div>
  }

  return (
    <img
      alt={alt}
      className="size-40 rounded-md object-cover border border-main-view-fg/10"
      src={resolvedSrc}
    />
  )
}
*/

/**
 * Example 7: Vue composition API component
 */
/*
import { ref, onMounted, watch } from 'vue'
import { mediaService } from '@jan/extensions-web'

export function useResolveImage(srcRef: Ref<string>) {
  const resolvedSrc = ref(srcRef.value)
  const loading = ref(false)

  const resolve = async () => {
    if (mediaService.hasJanIdPlaceholder(srcRef.value)) {
      loading.value = true
      try {
        resolvedSrc.value = await mediaService.resolveImageSrc(srcRef.value)
      } catch (error) {
        console.error('Failed to resolve:', error)
      } finally {
        loading.value = false
      }
    } else {
      resolvedSrc.value = srcRef.value
    }
  }

  onMounted(resolve)
  watch(srcRef, resolve)

  return { resolvedSrc, loading }
}
*/

// ============================================================================
// Batch Processing Examples
// ============================================================================

/**
 * Example 8: Resolve multiple images efficiently
 */
async function resolveBatchImages(imageSrcs: string[]) {
  console.log(`Resolving ${imageSrcs.length} images...`)
  
  // Resolve all in parallel
  const resolvedUrls = await mediaService.resolveImageSrcs(imageSrcs)
  
  console.log('All images resolved!')
  return resolvedUrls
}

/**
 * Example 9: Process message attachments
 */
async function processMessageAttachments(message: {
  attachments: Array<{ src: string; type: string; alt: string }>
}) {
  const imageAttachments = message.attachments.filter(a => a.type === 'image')
  
  console.log(`Processing ${imageAttachments.length} image attachments`)
  
  const resolvedAttachments = await Promise.all(
    imageAttachments.map(async (attachment) => {
      if (mediaService.hasJanIdPlaceholder(attachment.src)) {
        const resolvedSrc = await mediaService.resolveImageSrc(attachment.src)
        return { ...attachment, src: resolvedSrc, resolved: true }
      }
      return { ...attachment, resolved: false }
    })
  )
  
  return resolvedAttachments
}

// ============================================================================
// Performance Optimization Examples
// ============================================================================

/**
 * Example 10: Lazy load images with intersection observer
 */
function setupLazyImageLoading(containerSelector: string) {
  const observer = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement
          const janId = mediaService.extractJanId(img.dataset.src || '')
          
          if (janId) {
            // Load presigned URL only when image enters viewport
            const url = await mediaService.getPresignedUrlCached(janId)
            img.src = url
            observer.unobserve(img)
          }
        }
      }
    },
    { rootMargin: '50px' }
  )
  
  const images = document.querySelectorAll<HTMLImageElement>(
    `${containerSelector} img[data-src*="jan_"]`
  )
  
  images.forEach(img => observer.observe(img))
}

/**
 * Example 11: Preload images in background
 */
async function preloadImages(janIds: string[]) {
  console.log(`Preloading ${janIds.length} images...`)
  
  // Fetch and cache all presigned URLs
  await Promise.all(
    janIds.map(janId => mediaService.getPresignedUrlCached(janId))
  )
  
  console.log('All images preloaded and cached!')
}

/**
 * Example 12: Clear expired cache periodically
 */
function setupCacheCleanup() {
  // Clear cache every 45 minutes (URLs expire in ~50 min from cache)
  setInterval(() => {
    console.log('Clearing expired URL cache...')
    mediaService.clearUrlCache()
  }, 45 * 60 * 1000)
}

// ============================================================================
// Error Handling Examples
// ============================================================================

/**
 * Example 13: Robust image loading with fallback
 */
async function loadImageWithFallback(
  imgElement: HTMLImageElement,
  fallbackSrc: string = '/placeholder-image.png'
) {
  const originalSrc = imgElement.src
  
  try {
    if (mediaService.hasJanIdPlaceholder(originalSrc)) {
      const resolvedSrc = await mediaService.resolveImageSrc(originalSrc)
      imgElement.src = resolvedSrc
      
      // Handle image load errors
      imgElement.onerror = () => {
        console.error('Image failed to load, using fallback')
        imgElement.src = fallbackSrc
      }
    }
  } catch (error) {
    console.error('Failed to resolve image:', error)
    imgElement.src = fallbackSrc
  }
}

// ============================================================================
// Usage in Application
// ============================================================================

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Resolve all uploaded attachment images
  resolveAllImages('message-container')
  
  // Setup lazy loading for chat history
  setupLazyImageLoading('#chat-history')
  
  // Setup periodic cache cleanup
  setupCacheCleanup()
})

// Handle dynamically added images
const messageObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) {
        const images = node.querySelectorAll('img')
        images.forEach(async (img) => {
          if (mediaService.hasJanIdPlaceholder(img.src)) {
            await displayUploadedImage(img)
          }
        })
      }
    })
  })
})

messageObserver.observe(document.body, {
  childList: true,
  subtree: true
})

export {
  displayUploadedImage,
  extractAndResolve,
  displayWithCaching,
  resolveAllImages,
  resolveHtmlContent,
  resolveBatchImages,
  processMessageAttachments,
  setupLazyImageLoading,
  preloadImages,
  setupCacheCleanup,
  loadImageWithFallback
}

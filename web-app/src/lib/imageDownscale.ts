/**
 * Result of a downscale attempt. `mimeType` may change (e.g. an oversized PNG
 * re-encoded as PNG stays PNG; everything else falls back to JPEG to keep the
 * payload small).
 */
export type DownscaledImage = {
  dataUrl: string
  base64: string
  mimeType: string
  size: number
}

const base64Bytes = (base64: string): number => {
  // 4 base64 chars encode 3 bytes; subtract padding.
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = dataUrl
  })

/**
 * Downscale an image data URL so its longest edge does not exceed
 * `maxDimensionPx`, preserving aspect ratio. Returns `null` when no resize is
 * needed (image already within bounds, downscaling disabled, or on any
 * failure) so the caller keeps the original image untouched.
 *
 * Large images otherwise inflate the model's context (and base64 payload),
 * which is exactly what the "max image size" setting guards against.
 */
export async function downscaleImageDataUrl(
  dataUrl: string,
  maxDimensionPx: number,
  mimeType?: string
): Promise<DownscaledImage | null> {
  if (
    !dataUrl ||
    !Number.isFinite(maxDimensionPx) ||
    maxDimensionPx <= 0 ||
    typeof document === 'undefined'
  ) {
    return null
  }

  try {
    const img = await loadImage(dataUrl)
    const { naturalWidth: width, naturalHeight: height } = img
    const longestEdge = Math.max(width, height)

    // Already within bounds — nothing to do.
    if (longestEdge <= maxDimensionPx || width === 0 || height === 0) {
      return null
    }

    const scale = maxDimensionPx / longestEdge
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

    // Keep PNG lossless (preserves transparency); otherwise JPEG keeps it small.
    const outMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg'
    const outDataUrl =
      outMime === 'image/jpeg'
        ? canvas.toDataURL('image/jpeg', 0.92)
        : canvas.toDataURL('image/png')

    const base64 = outDataUrl.split(',')[1] ?? ''
    if (!base64) return null

    return {
      dataUrl: outDataUrl,
      base64,
      mimeType: outMime,
      size: base64Bytes(base64),
    }
  } catch (error) {
    console.debug('Image downscale failed; keeping original:', error)
    return null
  }
}

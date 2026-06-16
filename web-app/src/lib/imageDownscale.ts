/**
 * Result of normalizing an image. `mimeType` may differ from the input: WebP is
 * transcoded to PNG (not every vision backend — notably local llama.cpp — can
 * decode WebP), and downscaled non-PNG images are re-encoded as JPEG to keep the
 * payload small.
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

const isWebp = (mimeType?: string): boolean => mimeType === 'image/webp'

/**
 * Hard ceiling (longest edge, px) applied when transcoding WebP to PNG even if
 * downscaling is disabled ("Original"). PNG of a photo is far heavier than its
 * WebP source, so an 8K WebP would otherwise balloon into a huge PNG.
 */
const WEBP_TRANSCODE_MAX_PX = 4096

/**
 * Normalize an image data URL for sending to a model:
 *  - Downscale so its longest edge does not exceed `maxDimensionPx` (preserving
 *    aspect ratio). `0`/invalid disables downscaling.
 *  - Transcode WebP to PNG for broad backend compatibility, clamping the result
 *    to {@link WEBP_TRANSCODE_MAX_PX} even when downscaling is disabled.
 *
 * Returns `null` when no work is needed (image already within bounds and not
 * WebP) or on any failure, so the caller keeps the original image untouched.
 *
 * Large images otherwise inflate the model's context (and base64 payload),
 * which is exactly what the "max image size" setting guards against.
 */
export async function downscaleImageDataUrl(
  dataUrl: string,
  maxDimensionPx: number,
  mimeType?: string
): Promise<DownscaledImage | null> {
  if (!dataUrl || typeof document === 'undefined') {
    return null
  }

  const limit =
    Number.isFinite(maxDimensionPx) && maxDimensionPx > 0
      ? maxDimensionPx
      : Infinity
  const mustTranscode = isWebp(mimeType)
  // WebP transcoding always re-encodes to PNG; keep that PNG within a sane
  // ceiling even when the user disabled downscaling.
  const effectiveLimit = mustTranscode
    ? Math.min(limit, WEBP_TRANSCODE_MAX_PX)
    : limit

  try {
    const img = await loadImage(dataUrl)
    const { naturalWidth: width, naturalHeight: height } = img
    if (width === 0 || height === 0) return null

    const longestEdge = Math.max(width, height)
    const needsResize = longestEdge > effectiveLimit

    // Nothing to do — leave the original untouched.
    if (!needsResize && !mustTranscode) {
      return null
    }

    const scale = needsResize ? effectiveLimit / longestEdge : 1
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

    // Keep JPEG as JPEG; everything else (PNG, WebP) becomes PNG so we stay
    // lossless and preserve any transparency.
    const outMime =
      mimeType === 'image/jpeg' || mimeType === 'image/jpg'
        ? 'image/jpeg'
        : 'image/png'
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
    console.debug('Image normalize failed; keeping original:', error)
    return null
  }
}

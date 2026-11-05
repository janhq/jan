export const IMAGE_EXTS = ['jpg', 'jpeg', 'png']
export const AUDIO_EXTS = ['wav', 'mp3']
export const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']

export type UploadCapabilities = {
  /** The model can see images. */
  image: boolean
  audio: boolean
  video: boolean
}

export type RoutedUploads = {
  image: string[]
  audio: string[]
  video: string[]
  /** Everything else, plus audio/video the model cannot take. */
  documents: string[]
  /** Images the model cannot see. Document ingestion has no image parser, so
   * they are refused rather than attached as files that always fail to send. */
  rejected: string[]
}

const extOf = (path: string): string => path.toLowerCase().split('.').pop() ?? ''

/**
 * One upload picker, one routing rule: media goes to the model when it can take
 * it, images it cannot see are rejected, and everything else becomes a document
 * attachment. Drag-and-drop applies
 * the same split, so the two entry points cannot disagree.
 */
export function routeUploadPaths(
  paths: string[],
  can: UploadCapabilities
): RoutedUploads {
  const routed: RoutedUploads = {
    image: [],
    audio: [],
    video: [],
    documents: [],
    rejected: [],
  }
  for (const path of paths) {
    const ext = extOf(path)
    if (IMAGE_EXTS.includes(ext)) {
      if (can.image) routed.image.push(path)
      else routed.rejected.push(path)
    } else if (AUDIO_EXTS.includes(ext) && can.audio) routed.audio.push(path)
    else if (VIDEO_EXTS.includes(ext) && can.video) routed.video.push(path)
    else routed.documents.push(path)
  }
  return routed
}

export const SCREEN_CAPTURE_COMMIT_EVENT = 'jan-screen-capture-commit'

export type ScreenCaptureCommitDetail = {
  text: string
  sendNow?: boolean
}

/** Tauri WebviewWindow labels — must match capabilities and creation sites. */
export const SCREEN_CAPTURE_OVERLAY_LABEL = 'jan-screen-capture-overlay'
export const SCREEN_CAPTURE_REGION_LABEL = 'jan-screen-region-picker'

export const JAN_SCREEN_CAPTURE_PNG_EVENT = 'jan-screen-capture-png'

/** Shared between overlay and region webviews (same origin) so region capture keeps the composer text. */
export const SCREEN_CAPTURE_COMPOSER_STORAGE_KEY =
  'jan-screen-capture-composer-draft'

export function readScreenCaptureComposerDraft(): string {
  try {
    return sessionStorage.getItem(SCREEN_CAPTURE_COMPOSER_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeScreenCaptureComposerDraft(text: string): void {
  try {
    sessionStorage.setItem(SCREEN_CAPTURE_COMPOSER_STORAGE_KEY, text)
  } catch {
    /* ignore private mode / quota */
  }
}

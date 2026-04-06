export const SCREEN_CAPTURE_COMMIT_EVENT = 'jan-screen-capture-commit'

export type ScreenCaptureCommitDetail = {
  text: string
  sendNow?: boolean
}

/** Tauri WebviewWindow labels — must match capabilities and creation sites. */
export const SCREEN_CAPTURE_OVERLAY_LABEL = 'jan-screen-capture-overlay'
export const SCREEN_CAPTURE_REGION_LABEL = 'jan-screen-region-picker'

export const JAN_SCREEN_CAPTURE_PNG_EVENT = 'jan-screen-capture-png'

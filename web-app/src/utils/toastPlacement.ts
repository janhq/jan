import type { ToasterProps } from 'sonner'

export type NotificationPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export const NOTIFICATION_POSITIONS: readonly NotificationPosition[] = [
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
] as const

export function isNotificationPosition(
  value: string
): value is NotificationPosition {
  return (NOTIFICATION_POSITIONS as readonly string[]).includes(value)
}

/** Windows + Tauri: avoid overlap with custom caption controls (see janhq/jan#7878). */
export function getDefaultNotificationPosition(): NotificationPosition {
  if (IS_WINDOWS && IS_TAURI) {
    return 'bottom-right'
  }
  return 'top-right'
}

const TAURI_DRAG_REGION_PX = 48
const BASE_MARGIN = 8

export function getToastOffset(
  position: NotificationPosition
): NonNullable<ToasterProps['offset']> {
  const tauriTopSafe = IS_TAURI ? TAURI_DRAG_REGION_PX : 0

  switch (position) {
    case 'top-left':
      return { top: BASE_MARGIN + tauriTopSafe, left: BASE_MARGIN }
    case 'top-right':
      return {
        top: BASE_MARGIN + tauriTopSafe,
        right: BASE_MARGIN,
      }
    case 'bottom-left':
      return { bottom: BASE_MARGIN, left: BASE_MARGIN }
    case 'bottom-right':
      return { bottom: BASE_MARGIN, right: BASE_MARGIN }
  }
}

import { i18n } from '@/i18n/react-i18next-compat'
import {
  useInterfaceSettings,
  type RunNotificationSettings,
} from '@/hooks/useInterfaceSettings'
import { isPlatformTauri } from '@/lib/platform/utils'
import { useThreads } from '@/hooks/useThreads'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'

export type RunNotificationKind = 'finish' | 'error' | 'approval' | 'cancel'

export type RunNotificationInput = {
  kind: RunNotificationKind
  threadId: string
  /** Distinguishes repeated events for one thread (message or tool call id). */
  eventId: string
}

const SETTING_FOR_KIND: Record<
  RunNotificationKind,
  keyof Omit<RunNotificationSettings, 'enabled'>
> = {
  finish: 'onFinish',
  error: 'onError',
  approval: 'onApproval',
  cancel: 'onCancel',
}

const MAX_REMEMBERED = 200
const sent = new Set<string>()

export const kindIsEnabled = (
  settings: RunNotificationSettings,
  kind: RunNotificationKind
): boolean => settings.enabled && settings[SETTING_FOR_KIND[kind]]

export const threadIsOnScreen = (
  threadId: string,
  windowFocused: boolean,
  pathname: string
): boolean =>
  windowFocused && pathname.split('/').filter(Boolean).pop() === threadId

export const shouldNotify = (
  settings: RunNotificationSettings,
  input: RunNotificationInput,
  onScreen: boolean
): boolean => kindIsEnabled(settings, input.kind) && !onScreen

const rememberOnce = (key: string): boolean => {
  if (sent.has(key)) return false
  sent.add(key)
  if (sent.size > MAX_REMEMBERED) {
    sent.delete(sent.values().next().value as string)
  }
  return true
}

export const resetRunNotificationsForTest = () => sent.clear()

const titleOf = (threadId: string): string | undefined =>
  useThreads.getState().threads[threadId]?.title ||
  useCoworkSessions.getState().sessions.find((s) => s.id === threadId)?.title

async function windowIsFocused(): Promise<boolean> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  const [focused, minimized] = await Promise.all([
    win.isFocused(),
    win.isMinimized(),
  ])
  return focused && !minimized
}

export async function notifyRun(input: RunNotificationInput): Promise<void> {
  if (!isPlatformTauri()) return
  const settings = useInterfaceSettings.getState().runNotifications
  if (!kindIsEnabled(settings, input.kind)) return
  try {
    const onScreen = threadIsOnScreen(
      input.threadId,
      await windowIsFocused(),
      window.location.pathname
    )
    if (!shouldNotify(settings, input, onScreen)) return
    if (!rememberOnce(`${input.kind}:${input.threadId}:${input.eventId}`)) {
      return
    }
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import('@tauri-apps/plugin-notification')
    if (
      !(await isPermissionGranted()) &&
      (await requestPermission()) !== 'granted'
    ) {
      return
    }
    const name = titleOf(input.threadId)?.trim() || i18n.t('common:untitledThread')
    sendNotification({
      title: i18n.t(`common:runNotification.${input.kind}.title`),
      body: i18n.t(`common:runNotification.${input.kind}.body`, { name }),
    })
  } catch (error) {
    console.error('Run notification failed:', error)
  }
}

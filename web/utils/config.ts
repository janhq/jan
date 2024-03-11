import { AppConfiguration } from '@janhq/core'

export const defaultQuickAskHotKey = 'CommandOrControl+J'

export const defaultAppConfiguration: Partial<AppConfiguration> = {
  finish_onboarding: false,
  quick_ask_hotkey: defaultQuickAskHotKey,
}

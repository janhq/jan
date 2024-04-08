import { getAppConfigurations } from '@janhq/core/node'
import { registerShortcut } from './selectedText'
import { windowManager } from '../managers/window'
// TODO: Retrieve from config later
const quickAskHotKey = 'CommandOrControl+J'

export function registerGlobalShortcuts() {
  if (!getAppConfigurations().quick_ask) return
  const ret = registerShortcut(quickAskHotKey, (selectedText: string) => {
    // Feature Toggle for Quick Ask
    if (!windowManager.isQuickAskWindowVisible()) {
      windowManager.showQuickAskWindow()
      windowManager.sendQuickAskSelectedText(selectedText)
    } else {
      windowManager.hideQuickAskWindow()
    }
  })

  if (!ret) {
    console.error('Global shortcut registration failed')
  } else {
    console.log('Global shortcut registered successfully')
  }
}

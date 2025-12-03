import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { PlatformShortcuts, ShortcutAction } from '@/lib/shortcuts'
import { useToolCallPanel } from '@/hooks/useToolCallPanel'

export function KeyboardShortcutsProvider() {
  const { open, setLeftPanel } = useLeftPanel()
  const { closePanel: closeToolPanel } = useToolCallPanel()
  const router = useRouter()

  // Get shortcut specs from centralized configuration
  const sidebarShortcut = PlatformShortcuts[ShortcutAction.TOGGLE_SIDEBAR]
  const newChatShortcut = PlatformShortcuts[ShortcutAction.NEW_CHAT]
  const settingsShortcut = PlatformShortcuts[ShortcutAction.GO_TO_SETTINGS]

  // Toggle Sidebar
  useKeyboardShortcut({
    ...sidebarShortcut,
    callback: () => {
      setLeftPanel(!open)
      // Close tool panel when opening left panel
      if (!open) {
        closeToolPanel()
      }
    },
  })

  // New Chat
  useKeyboardShortcut({
    ...newChatShortcut,
    callback: () => {
      router.navigate({ to: route.home })
    },
  })

  // Go to Settings
  useKeyboardShortcut({
    ...settingsShortcut,
    callback: () => {
      router.navigate({ to: route.settings.general })
    },
  })

  // This component doesn't render anything
  return null
}

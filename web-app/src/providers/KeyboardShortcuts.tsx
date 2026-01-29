import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useSearchDialog } from '@/hooks/useSearchDialog'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { PlatformShortcuts, ShortcutAction } from '@/lib/shortcuts'

export function KeyboardShortcutsProvider() {
  const { open, setLeftPanel } = useLeftPanel()
  const { setOpen: setSearchOpen } = useSearchDialog()
  const router = useRouter()

  // Get shortcut specs from centralized configuration
  const sidebarShortcut = PlatformShortcuts[ShortcutAction.TOGGLE_SIDEBAR]
  const newChatShortcut = PlatformShortcuts[ShortcutAction.NEW_CHAT]
  const settingsShortcut = PlatformShortcuts[ShortcutAction.GO_TO_SETTINGS]
  const searchShortcut = PlatformShortcuts[ShortcutAction.SEARCH]

  // Toggle Sidebar
  useKeyboardShortcut({
    ...sidebarShortcut,
    callback: () => {
      setLeftPanel(!open)
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

  // Search
  useKeyboardShortcut({
    ...searchShortcut,
    callback: () => {
      setSearchOpen(true)
    },
  })

  // This component doesn't render anything
  return null
}

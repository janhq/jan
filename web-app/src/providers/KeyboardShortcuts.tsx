import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import { useLeftPanel } from '@/hooks/useLeftPanel'
<<<<<<< HEAD
=======
import { useSearchDialog } from '@/hooks/useSearchDialog'
import { useProjectDialog } from '@/hooks/useProjectDialog'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { PlatformShortcuts, ShortcutAction } from '@/lib/shortcuts'

export function KeyboardShortcutsProvider() {
  const { open, setLeftPanel } = useLeftPanel()
<<<<<<< HEAD
=======
  const { setOpen: setSearchOpen } = useSearchDialog()
  const { setOpen: setProjectDialogOpen } = useProjectDialog()
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  const router = useRouter()

  // Get shortcut specs from centralized configuration
  const sidebarShortcut = PlatformShortcuts[ShortcutAction.TOGGLE_SIDEBAR]
  const newChatShortcut = PlatformShortcuts[ShortcutAction.NEW_CHAT]
<<<<<<< HEAD
  const settingsShortcut = PlatformShortcuts[ShortcutAction.GO_TO_SETTINGS]
=======
  const newProjectShortcut = PlatformShortcuts[ShortcutAction.NEW_PROJECT]
  const settingsShortcut = PlatformShortcuts[ShortcutAction.GO_TO_SETTINGS]
  const searchShortcut = PlatformShortcuts[ShortcutAction.SEARCH]
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

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

<<<<<<< HEAD
=======
  // New Project
  useKeyboardShortcut({
    ...newProjectShortcut,
    callback: () => {
      setProjectDialogOpen(true)
    },
  })

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  // Go to Settings
  useKeyboardShortcut({
    ...settingsShortcut,
    callback: () => {
      router.navigate({ to: route.settings.general })
    },
  })

<<<<<<< HEAD
=======
  // Search
  useKeyboardShortcut({
    ...searchShortcut,
    callback: () => {
      setSearchOpen(true)
    },
  })

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  // This component doesn't render anything
  return null
}

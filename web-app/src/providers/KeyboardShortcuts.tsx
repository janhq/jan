import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'

export function KeyboardShortcutsProvider() {
  const { open, setLeftPanel } = useLeftPanel()
  const router = useRouter()

  // Toggle Sidebar (⌘/Ctrl B)
  useKeyboardShortcut({
    key: 'b',
    usePlatformMetaKey: true,
    callback: () => {
      setLeftPanel(!open)
    },
  })

  // New Chat (⌘/Ctrl N)
  useKeyboardShortcut({
    key: 'n',
    usePlatformMetaKey: true,
    excludeRoutes: [route.home],
    callback: () => {
      router.navigate({ to: route.home })
    },
  })

  // Go to Settings (⌘/Ctrl ,)
  useKeyboardShortcut({
    key: ',',
    usePlatformMetaKey: true,
    callback: () => {
      router.navigate({ to: route.settings.general })
    },
  })

  // This component doesn't render anything
  return null
}

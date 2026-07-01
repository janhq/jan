import { useCallback, useEffect, useMemo } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import {
  useTitlebarLayout,
  type ButtonId,
  type TitlebarLayout,
  DEFAULT_TITLEBAR_LAYOUT,
} from '@/stores/titlebar-layout-store'

// The native command always returns both sides, but a malformed/partial payload
// must not crash the render — coerce to arrays and fall back to defaults.
const sanitizeLayout = (l: Partial<TitlebarLayout> | null | undefined): TitlebarLayout => ({
  left: Array.isArray(l?.left) ? l.left : DEFAULT_TITLEBAR_LAYOUT.left,
  right: Array.isArray(l?.right) ? l.right : DEFAULT_TITLEBAR_LAYOUT.right,
})

export const WindowControls = () => {
  // getCurrentWebviewWindow() returns a fresh instance each call; memoize so it
  // doesn't re-trigger the focus-listener effect on every render (infinite loop).
  const appWindow = useMemo(() => getCurrentWebviewWindow(), [])
  const layout = sanitizeLayout(useTitlebarLayout((s) => s.layout))
  const setLayout = useTitlebarLayout((s) => s.setLayout)

  const refresh = useCallback(() => {
    invoke<TitlebarLayout>('get_titlebar_layout')
      .then((l) => setLayout(sanitizeLayout(l)))
      .catch(() => setLayout(DEFAULT_TITLEBAR_LAYOUT))
  }, [setLayout])

  // Refetch on focus so changes made in the DE's settings (KDE/GNOME) while Jan
  // was unfocused are picked up without a restart.
  useEffect(() => {
    refresh()
    if (!IS_LINUX) return
    const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) refresh()
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [appWindow, refresh])

  const actions: Record<ButtonId, () => Promise<void>> = {
    minimize: () => appWindow.minimize(),
    maximize: () => appWindow.toggleMaximize(),
    close: () => appWindow.close(),
  }
  const icons: Record<ButtonId, React.ReactNode> = {
    minimize: <Minus className="size-4" />,
    maximize: <Square className="size-3" />,
    close: <X className="size-4" />,
  }
  const labels: Record<ButtonId, string> = {
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
  }

  const renderGroup = (ids: ButtonId[]) =>
    ids.map((id) => (
      <Button
        key={id}
        onClick={actions[id]}
        aria-label={labels[id]}
        variant="ghost"
        size="icon-sm"
      >
        {icons[id]}
      </Button>
    ))

  return (
    <>
      {layout.left.length > 0 && (
        <div className="absolute top-0 z-[60] left-4 h-15">
          <div className="flex items-center h-full">
            {renderGroup(layout.left)}
          </div>
        </div>
      )}
      {layout.right.length > 0 && (
        <div className="absolute top-0 z-[60] right-4 h-15">
          <div className="flex items-center h-full">
            {renderGroup(layout.right)}
          </div>
        </div>
      )}
    </>
  )
}

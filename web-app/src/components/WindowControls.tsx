import { useCallback, useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'

type ButtonId = 'minimize' | 'maximize' | 'close'
type TitlebarLayout = { left: ButtonId[]; right: ButtonId[] }

const DEFAULT_LAYOUT: TitlebarLayout = {
  left: [],
  right: ['minimize', 'maximize', 'close'],
}

export const WindowControls = () => {
  const appWindow = getCurrentWebviewWindow()
  const [layout, setLayout] = useState<TitlebarLayout>(DEFAULT_LAYOUT)

  const refresh = useCallback(() => {
    invoke<TitlebarLayout>('get_titlebar_layout')
      .then((l) => setLayout(l))
      .catch(() => setLayout(DEFAULT_LAYOUT))
  }, [])

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
        <div className="absolute top-0 z-50 left-4 h-15">
          <div className="flex items-center h-full">
            {renderGroup(layout.left)}
          </div>
        </div>
      )}
      {layout.right.length > 0 && (
        <div className="absolute top-0 z-50 right-4 h-15">
          <div className="flex items-center h-full">
            {renderGroup(layout.right)}
          </div>
        </div>
      )}
    </>
  )
}

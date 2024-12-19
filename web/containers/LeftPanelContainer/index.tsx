import {
  Fragment,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react'

import { ScrollArea, useClickOutside, useMediaQuery } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { showLeftPanelAtom } from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

type Props = PropsWithChildren

const DEFAULT_LEFT_PANEL_WIDTH = 200
export const LEFT_PANEL_WIDTH = 'leftPanelWidth'

const LeftPanelContainer = ({ children }: Props) => {
  const [leftPanelRef, setLeftPanelRef] = useState<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [threadLeftPanelWidth, setLeftPanelWidth] = useState(
    Number(localStorage.getItem(LEFT_PANEL_WIDTH)) || DEFAULT_LEFT_PANEL_WIDTH
  )
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const matches = useMediaQuery('(max-width: 880px)')
  const reduceTransparent = useAtomValue(reduceTransparentAtom)

  useClickOutside(
    () => matches && showLeftPanel && setShowLeftPanel(false),
    null,
    [leftPanelRef]
  )

  const startResizing = useCallback(() => {
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback(
    (mouseMoveEvent: { clientX: number }) => {
      if (isResizing) {
        if (leftPanelRef !== null) {
          if (
            mouseMoveEvent.clientX -
              leftPanelRef?.getBoundingClientRect().left <
            170
          ) {
            setIsResizing(false)
            setLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH)
            localStorage.setItem(
              LEFT_PANEL_WIDTH,
              String(DEFAULT_LEFT_PANEL_WIDTH)
            )
            setShowLeftPanel(false)
          } else {
            const resized =
              mouseMoveEvent.clientX -
              leftPanelRef?.getBoundingClientRect().left
            localStorage.setItem(LEFT_PANEL_WIDTH, String(resized))
            setLeftPanelWidth(resized)
          }
        }
      }
    },
    [isResizing, leftPanelRef, setShowLeftPanel]
  )

  useEffect(() => {
    if (localStorage.getItem(LEFT_PANEL_WIDTH) === null) {
      setLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH)
      localStorage.setItem(LEFT_PANEL_WIDTH, String(DEFAULT_LEFT_PANEL_WIDTH))
    }
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  return (
    <div
      ref={setLeftPanelRef}
      className={twMerge(
        'flex h-full flex-shrink-0 flex-col transition-all duration-100',
        showLeftPanel ? 'opacity-100' : 'w-0 translate-x-full opacity-0',
        isResizing && 'cursor-col-resize',
        matches &&
          'absolute left-2 z-[100] rounded-s-lg border-r border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]',
        reduceTransparent &&
          'left-0 border-r border-[hsla(var(--app-border))] bg-[hsla(var(--left-panel-bg))]'
      )}
      style={{ width: showLeftPanel ? threadLeftPanelWidth : 0 }}
      onMouseDown={(e) => isResizing && e.stopPropagation()}
    >
      <ScrollArea className="h-full w-full">
        {children}
        {showLeftPanel && !matches && (
          <Fragment>
            <div
              className={twMerge(
                'group/resize absolute right-0 top-0 z-40 h-full w-1 flex-shrink-0 flex-grow-0 resize-x blur-sm hover:cursor-col-resize hover:bg-[hsla(var(--resize-bg))]',
                isResizing && 'cursor-col-resize bg-[hsla(var(--resize-bg))]',
                !reduceTransparent && 'shadow-sm'
              )}
              onMouseDown={startResizing}
            />
          </Fragment>
        )}
      </ScrollArea>
    </div>
  )
}

export default LeftPanelContainer

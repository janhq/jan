import {
  Fragment,
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { ScrollArea, useMediaQuery } from '@janhq/joi'
import { useAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import { showLeftPanelAtom } from '@/helpers/atoms/App.atom'

type Props = PropsWithChildren

const DEFAULT_LEFT_PANEL_WIDTH = 200
const LEFT_PANEL_WIDTH = 'leftPanelWidth'

const LeftPanelContainer = ({ children }: Props) => {
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [threadLeftPanelWidth, setLeftPanelWidth] = useState(
    Number(localStorage.getItem(LEFT_PANEL_WIDTH)) || DEFAULT_LEFT_PANEL_WIDTH
  )
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const matches = useMediaQuery('(max-width: 880px)')

  const startResizing = useCallback(() => {
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback(
    (mouseMoveEvent: { clientX: number }) => {
      if (isResizing) {
        if (leftPanelRef.current !== null) {
          if (
            mouseMoveEvent.clientX -
              leftPanelRef?.current.getBoundingClientRect().left <
            195
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
              leftPanelRef?.current.getBoundingClientRect().left
            localStorage.setItem(LEFT_PANEL_WIDTH, String(resized))
            setLeftPanelWidth(resized)
          }
        }
      }
    },
    [isResizing, setShowLeftPanel]
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
      ref={leftPanelRef}
      className={twMerge(
        'flex h-full flex-shrink-0 flex-col border-r border-[hsla(var(--left-panel-border))] bg-[hsla(var(--left-panel-bg))] transition-all duration-100',
        showLeftPanel ? 'opacity-100' : 'w-0 translate-x-full opacity-0',
        isResizing && 'cursor-col-resize',
        matches && 'absolute left-0 z-[999]'
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
                'group/resize absolute right-0 top-0 h-full w-1 flex-shrink-0 flex-grow-0 resize-x shadow-sm blur-sm hover:cursor-col-resize hover:bg-[hsla(var(--resize-bg))]',
                isResizing && 'cursor-col-resize bg-[hsla(var(--resize-bg))]'
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

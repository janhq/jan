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

import { showRightPanelAtom } from '@/helpers/atoms/App.atom'

type Props = PropsWithChildren

const DEFAULT_RIGTH_PANEL_WIDTH = 280
const RIGHT_PANEL_WIDTH = 'rightPanelWidth'

const RightPanelContainer = ({ children }: Props) => {
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [threadRightPanelWidth, setRightPanelWidth] = useState(
    Number(localStorage.getItem(RIGHT_PANEL_WIDTH)) || DEFAULT_RIGTH_PANEL_WIDTH
  )
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)
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
        if (rightPanelRef.current !== null) {
          if (
            rightPanelRef?.current.getBoundingClientRect().right -
              mouseMoveEvent.clientX <
            260
          ) {
            setRightPanelWidth(DEFAULT_RIGTH_PANEL_WIDTH)
            setIsResizing(false)
            localStorage.setItem(
              RIGHT_PANEL_WIDTH,
              String(DEFAULT_RIGTH_PANEL_WIDTH)
            )
            setShowRightPanel(false)
          } else {
            const resized =
              rightPanelRef?.current.getBoundingClientRect().right -
              mouseMoveEvent.clientX
            localStorage.setItem(RIGHT_PANEL_WIDTH, String(resized))
            setRightPanelWidth(resized)
          }
        }
      }
    },
    [isResizing, setShowRightPanel]
  )

  useEffect(() => {
    if (localStorage.getItem(RIGHT_PANEL_WIDTH) === null) {
      setRightPanelWidth(DEFAULT_RIGTH_PANEL_WIDTH)
      localStorage.setItem(RIGHT_PANEL_WIDTH, String(DEFAULT_RIGTH_PANEL_WIDTH))
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
      ref={rightPanelRef}
      className={twMerge(
        'relative flex h-full flex-shrink-0 flex-col border-l border-[hsla(var(--left-panel-border))] bg-[hsla(var(--left-panel-bg))] transition-all duration-100',
        showRightPanel ? 'opacity-100' : 'w-0 translate-x-full opacity-0',
        isResizing && 'cursor-col-resize',
        matches && 'absolute right-0 z-50'
      )}
      style={{ width: showRightPanel ? threadRightPanelWidth : 0 }}
      onMouseDown={(e) => isResizing && e.preventDefault()}
    >
      <ScrollArea className="h-full w-full">
        {children}
        {showRightPanel && !matches && (
          <Fragment>
            <div
              className={twMerge(
                'group/resize absolute left-0 top-0 h-full w-1 flex-shrink-0 flex-grow-0 resize-x shadow-sm blur-sm hover:cursor-col-resize hover:bg-[hsla(var(--resize-bg))]',
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

export default RightPanelContainer

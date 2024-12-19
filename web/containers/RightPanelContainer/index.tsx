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

import { showRightPanelAtom } from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'

type Props = PropsWithChildren

const DEFAULT_RIGHT_PANEL_WIDTH = 280
export const RIGHT_PANEL_WIDTH = 'rightPanelWidth'

const RightPanelContainer = ({ children }: Props) => {
  const [isResizing, setIsResizing] = useState(false)
  const [threadRightPanelWidth, setRightPanelWidth] = useState(
    Number(localStorage.getItem(RIGHT_PANEL_WIDTH)) || DEFAULT_RIGHT_PANEL_WIDTH
  )
  const [rightPanelRef, setRightPanelRef] = useState<HTMLDivElement | null>(
    null
  )
  const reduceTransparent = useAtomValue(reduceTransparentAtom)

  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)
  const matches = useMediaQuery('(max-width: 880px)')

  useClickOutside(
    () => matches && showRightPanel && setShowRightPanel(false),
    null,
    [rightPanelRef]
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
        if (rightPanelRef !== null) {
          if (
            rightPanelRef?.getBoundingClientRect().right -
              mouseMoveEvent.clientX <
            200
          ) {
            setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)
            setIsResizing(false)
            localStorage.setItem(
              RIGHT_PANEL_WIDTH,
              String(DEFAULT_RIGHT_PANEL_WIDTH)
            )
            setShowRightPanel(false)
          } else {
            const resized =
              rightPanelRef?.getBoundingClientRect().right -
              mouseMoveEvent.clientX
            localStorage.setItem(RIGHT_PANEL_WIDTH, String(resized))
            setRightPanelWidth(resized)
          }
        }
      }
    },
    [isResizing, rightPanelRef, setShowRightPanel]
  )

  useEffect(() => {
    if (localStorage.getItem(RIGHT_PANEL_WIDTH) === null) {
      setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)
      localStorage.setItem(RIGHT_PANEL_WIDTH, String(DEFAULT_RIGHT_PANEL_WIDTH))
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
      ref={setRightPanelRef}
      className={twMerge(
        'relative flex h-full flex-shrink-0 flex-col transition-all duration-100',
        showRightPanel ? 'opacity-100' : 'w-0 translate-x-full opacity-0',
        isResizing && 'cursor-col-resize',
        matches &&
          'absolute right-2 z-50 rounded-e-lg border-l border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]',
        reduceTransparent &&
          'border-l border-[hsla(var(--app-border))] bg-[hsla(var(--right-panel-bg))]'
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
                'group/resize absolute left-0 top-0 z-40 h-full w-1 flex-shrink-0 flex-grow-0 resize-x blur-sm hover:cursor-col-resize hover:bg-[hsla(var(--resize-bg))]',
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

export default RightPanelContainer

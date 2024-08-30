import { Fragment, PropsWithChildren, useEffect, useRef } from 'react'

import { useMediaQuery } from '@janhq/joi'
import { useAtom } from 'jotai'

import { showLeftPanelAtom, showRightPanelAtom } from '@/helpers/atoms/App.atom'

const Responsive = ({ children }: PropsWithChildren) => {
  const matches = useMediaQuery('(max-width: 880px)')
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)

  // Refs to store the last known state of the panels
  const lastLeftPanelState = useRef<boolean>(true)
  const lastRightPanelState = useRef<boolean>(true)

  useEffect(() => {
    if (matches) {
      // Store the last known state before closing the panels
      lastLeftPanelState.current = showLeftPanel
      lastRightPanelState.current = showRightPanel

      setShowLeftPanel(false)
      setShowRightPanel(false)
    } else {
      // Restore the last known state when the screen is resized back
      setShowLeftPanel(lastLeftPanelState.current)
      setShowRightPanel(lastRightPanelState.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, setShowLeftPanel, setShowRightPanel])

  return <Fragment>{children}</Fragment>
}

export default Responsive

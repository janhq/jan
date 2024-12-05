import { Fragment, useEffect, useRef } from 'react'

import { useMediaQuery } from '@janhq/joi'
import { useAtom } from 'jotai'

import { showLeftPanelAtom, showRightPanelAtom } from '@/helpers/atoms/App.atom'

const Responsive = () => {
  const matches = useMediaQuery('(max-width: 880px)')
  const [showLeftPanel, setShowLeftPanel] = useAtom(showLeftPanelAtom)
  const [showRightPanel, setShowRightPanel] = useAtom(showRightPanelAtom)

  // Refs to store the last known state of the panels
  const lastLeftPanelState = useRef<boolean>(showLeftPanel)
  const lastRightPanelState = useRef<boolean>(showRightPanel)

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

  return <Fragment></Fragment>
}

export default Responsive

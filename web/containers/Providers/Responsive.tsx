import { Fragment, PropsWithChildren, useEffect } from 'react'

import { useMediaQuery } from '@janhq/joi'

import { useSetAtom } from 'jotai'

import { showLeftPanelAtom, showRightPanelAtom } from '@/helpers/atoms/App.atom'

const Responsive = ({ children }: PropsWithChildren) => {
  const matches = useMediaQuery('(max-width: 880px)')
  const setShowLeftPanel = useSetAtom(showLeftPanelAtom)
  const setShowRightPanel = useSetAtom(showRightPanelAtom)

  useEffect(() => {
    if (matches) {
      setShowLeftPanel(false)
      setShowRightPanel(false)
    } else {
      setShowLeftPanel(true)
      setShowRightPanel(true)
    }
  }, [matches, setShowLeftPanel, setShowRightPanel])

  return <Fragment>{children}</Fragment>
}

export default Responsive

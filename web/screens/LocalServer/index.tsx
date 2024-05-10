'use client'

import ModalTroubleShooting from '@/containers/ModalTroubleShoot'

import LocalServerCenterPanel from './LocalServerCenterPanel'
import LocalServerLeftPanel from './LocalServerLeftPanel'
import LocalServerRightPanel from './LocalServerRightPanel'

const LocalServerScreen = () => {
  return (
    <div
      className="relative flex h-full w-full overflow-hidden"
      data-testid="local-server-testid"
    >
      <LocalServerLeftPanel />
      <LocalServerCenterPanel />
      <LocalServerRightPanel />
      <ModalTroubleShooting />
    </div>
  )
}

export default LocalServerScreen

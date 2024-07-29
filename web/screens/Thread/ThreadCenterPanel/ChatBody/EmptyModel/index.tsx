import { memo } from 'react'

import LogoMark from '@/containers/Brand/Logo/Mark'

import CenterPanelContainer from '@/containers/CenterPanelContainer'

import OnDeviceStarterScreen from './OnDeviceListStarter'

const EmptyModel = () => {
  return (
    <CenterPanelContainer>
      <div className="mx-auto flex h-full w-3/4 flex-col items-center justify-center text-center">
        <LogoMark
          className="mx-auto mb-4 animate-wave"
          width={48}
          height={48}
        />
        <h1 className="text-base font-semibold">Select a model to start</h1>

        <div className="mt-10 w-full lg:w-1/2">
          <OnDeviceStarterScreen />
        </div>
      </div>
    </CenterPanelContainer>
  )
}

export default memo(EmptyModel)

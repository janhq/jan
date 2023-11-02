import React from 'react'

import CenterContainer from '../CenterContainer'
import LeftContainer from '../LeftContainer'
import MonitorBar from '../MonitorBar'
import RightContainer from '../RightContainer'

const MainContainer: React.FC = () => (
  <div className="flex h-screen">
    <div className="flex flex-1 flex-col ">
      <div className="flex flex-1 overflow-hidden">
        <LeftContainer />
        <CenterContainer />
        <RightContainer />
      </div>
      <MonitorBar />
    </div>
  </div>
)

export default MainContainer

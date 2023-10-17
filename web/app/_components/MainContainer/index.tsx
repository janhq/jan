import React from "react"
import LeftContainer from "../LeftContainer"
import LeftRibbonNav from "../LeftRibbonNav"
import MonitorBar from "../MonitorBar"
import RightContainer from "../RightContainer"
import CenterContainer from "../CenterContainer"

const MainContainer: React.FC = () => (
  <div className="flex h-screen">
    <LeftRibbonNav />

    <div className="flex flex-1 flex-col h-full">
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

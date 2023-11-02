import React from 'react'

import MainHeader from '../MainHeader'
import MainView from '../MainView'

const CenterContainer: React.FC = () => (
  <div className="flex flex-1 flex-col dark:bg-gray-950/50">
    <MainHeader />
    <MainView />
  </div>
)

export default React.memo(CenterContainer)

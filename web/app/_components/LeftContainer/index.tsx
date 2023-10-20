import React, { Fragment } from 'react'
import SidebarFooter from '../SidebarFooter'
import SidebarHeader from '../SidebarHeader'
import SidebarMenu from '../SidebarMenu'
import HistoryList from '../HistoryList'
import NewChatButton from '../NewChatButton'

const LeftContainer: React.FC = () => (
  <Fragment>
    <SidebarHeader />
    <NewChatButton />
    <HistoryList />
    <SidebarMenu />
    <SidebarFooter />
  </Fragment>
)

export default React.memo(LeftContainer)

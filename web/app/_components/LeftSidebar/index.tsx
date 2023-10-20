import React from 'react'
import SearchBar from '../SearchBar'
// import ShortcutList from "../ShortcutList";
import HistoryList from '../HistoryList'
import DiscordContainer from '../DiscordContainer'
import JanLogo from '../JanLogo'

const LeftSidebar: React.FC = () => (
  <div className="hidden h-screen flex-shrink-0 flex-col overflow-hidden border-r border-gray-200 dark:bg-gray-800 lg:inset-y-0 lg:flex lg:w-72 lg:flex-col">
    <JanLogo />
    <div className="flex flex-1 flex-col gap-3 overflow-x-hidden">
      <SearchBar />
      {/* <ShortcutList /> */}
      <HistoryList />
    </div>
    <DiscordContainer />
  </div>
)

export default LeftSidebar

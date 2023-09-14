import React from "react";
import SearchBar from "../SearchBar";
import ShortcutList from "../ShortcutList";
import HistoryList from "../HistoryList";
import DiscordContainer from "../DiscordContainer";
import JanLogo from "../JanLogo";

const LeftSidebar: React.FC = () => (
  <div className="hidden h-screen lg:flex flex-col lg:inset-y-0 lg:w-72 lg:flex-col flex-shrink-0 overflow-hidden border-r border-gray-200 dark:bg-gray-800">
    <JanLogo />
    <div className="flex flex-col flex-1 gap-3 overflow-x-hidden">
      <SearchBar />
      <ShortcutList />
      <HistoryList />
    </div>
    <DiscordContainer />
  </div>
);

export default LeftSidebar;

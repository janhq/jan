import React from "react";
import SidebarFooter from "../SidebarFooter";
import SidebarHeader from "../SidebarHeader";
import SidebarMenu from "../SidebarMenu";
import HistoryList from "../HistoryList";
import NewChatButton from "../NewChatButton";

const LeftContainer: React.FC = () => (
  <div className="w-[323px] flex-shrink-0 p-3 h-screen border-r border-gray-200 flex flex-col">
    <SidebarHeader />
    <NewChatButton />
    <HistoryList />
    <SidebarMenu />
    <SidebarFooter />
  </div>
);

export default React.memo(LeftContainer);

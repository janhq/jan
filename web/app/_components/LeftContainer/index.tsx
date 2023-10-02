import React from "react";
import SidebarFooter from "../SidebarFooter";
import SidebarHeader from "../SidebarHeader";
import SidebarMenu from "../SidebarMenu";
import HistoryList from "../HistoryList";
import SecondaryButton from "../SecondaryButton";

const LeftContainer: React.FC = () => (
  <div className="w-[323px] flex-shrink-0 p-3 h-screen border-r border-gray-200 flex flex-col">
    <SidebarHeader />
    <div className="h-5" />
    <SecondaryButton title={"New Chat"} onClick={() => {}} />
    <div className="h-6" />
    <HistoryList />
    <SidebarMenu />
    <SidebarFooter />
  </div>
);

export default React.memo(LeftContainer);

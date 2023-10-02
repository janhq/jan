import React from "react";
import SidebarFooter from "../SidebarFooter";
import SidebarHeader from "../SidebarHeader";
import SidebarMenu from "../SidebarMenu";
import HistoryList from "../HistoryList";
import { SidebarButton } from "../SidebarButton";

const LeftContainer: React.FC = () => (
  <div className="w-[323px] flex-shrink-0 p-3 h-screen border-r border-gray-200 flex flex-col">
    <SidebarHeader />
    <SidebarButton
      className="flex shadow-sm items-center border border-gray-300 w-full rounded-md py-[9px] pl-[15px] pr-[17px] justify-center gap-2 text-gray-700 text-sm leading-5 font-medium bg-white"
      height={20}
      icon="/icons/plus_sm.svg"
      title="New Chat"
      width={20}
    />
    <HistoryList />
    <SidebarMenu />
    <SidebarFooter />
  </div>
);

export default React.memo(LeftContainer);

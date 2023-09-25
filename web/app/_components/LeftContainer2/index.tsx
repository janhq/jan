import React from "react";
import SidebarFooter from "../SidebarFooter";
import SidebarHeader from "../SidebarHeader";
import SidebarMenu from "../SidebarMenu";
import SidebarEmptyHistory from "../SidebarEmptyHistory";

const LeftContainer2: React.FC = () => (
  <div className="w-[323px] flex-shrink-0 p-3 h-screen border-r border-gray-200 flex flex-col">
    <SidebarHeader />
    <SidebarEmptyHistory />
    <SidebarMenu />
    <SidebarFooter />
  </div>
);

export default React.memo(LeftContainer2);

import React from "react";
import { MainViewState } from "@/_helpers/JotaiWrapper";
import SidebarMenuItem from "../SidebarMenuItem";

const menu = [
  {
    name: "Explore Models",
    icon: "Search_gray",
    state: MainViewState.ExploreModel,
  },
  {
    name: "My Models",
    icon: "ViewGrid",
    state: MainViewState.MyModel,
  },
  {
    name: "Settings",
    icon: "Cog",
    state: MainViewState.Setting,
  },
];

const SidebarMenu: React.FC = () => (
  <div className="flex flex-col">
    <div className="text-gray-500 text-xs font-semibold py-2 pl-2 pr-3">
      Your Configurations
    </div>
    <ul role="list" className="-mx-2 mt-2 space-y-1 mb-2">
      {menu.map((item) => (
        <SidebarMenuItem
          title={item.name}
          viewState={item.state}
          iconName={item.icon}
          key={item.name}
        />
      ))}
    </ul>
  </div>
);

export default React.memo(SidebarMenu);

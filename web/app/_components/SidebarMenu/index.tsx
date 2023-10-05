import React from "react";
import SidebarMenuItem from "../SidebarMenuItem";
import { MainViewState } from "@/_helpers/atoms/MainView.atom";

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
  <ul role="list" className="mx-1 mt-2 space-y-1 mb-2">
    {menu.map((item) => (
      <SidebarMenuItem
        title={item.name}
        viewState={item.state}
        iconName={item.icon}
        key={item.name}
      />
    ))}
  </ul>
);

export default React.memo(SidebarMenu);

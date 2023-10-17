import React from "react";
import MainHeader from "../MainHeader";
import MainView from "../MainView";

const CenterContainer: React.FC = () => (
  <div className="flex-1 flex flex-col">
    <MainHeader />
    <MainView />
  </div>
);

export default React.memo(CenterContainer);

import MainView from "../MainView";
import MonitorBar from "../MonitorBar";

const RightContainer = () => (
  <div className="flex flex-col flex-1 h-screen">
    <MainView />
    <MonitorBar />
  </div>
);

export default RightContainer;

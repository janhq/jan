import ChatContainer from "../ChatContainer";
import MonitorBar from "../MonitorBar";

const RightContainer = () => (
  <div className="flex flex-col flex-1 h-screen">
    <ChatContainer />
    <MonitorBar />
  </div>
);

export default RightContainer;

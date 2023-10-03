import ChatContainer from "../ChatContainer";
import MainChat from "../MainChat";
import MonitorBar from "../MonitorBar";

const RightContainer = () => (
  <div className="flex flex-col flex-1 h-screen">
    <ChatContainer>
      <MainChat />
    </ChatContainer>
    <MonitorBar />
  </div>
);

export default RightContainer;

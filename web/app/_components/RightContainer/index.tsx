import ChatContainer from "../ChatContainer";
import Header from "../Header";
import MainChat from "../MainChat";
import MonitorBar from "../MonitorBar";

const RightContainer = () => (
  <div className="flex flex-col flex-1 h-screen">
    <Header />
    <ChatContainer>
      <MainChat />
    </ChatContainer>
    <MonitorBar />
  </div>
);

export default RightContainer;

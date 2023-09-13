import ChatContainer from "../ChatContainer";
import Header from "../Header";
import MainChat from "../MainChat";

const RightContainer = () => (
  <div className="flex flex-col flex-1 h-screen">
    <Header />
    <ChatContainer>
      <MainChat />
    </ChatContainer>
  </div>
);

export default RightContainer;

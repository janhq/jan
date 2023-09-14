import ChatBody from "../ChatBody";
import InputToolbar from "../InputToolbar";
import MainChatHeader from "../MainChatHeader";

const MainChat: React.FC = () => (
  <div className="flex flex-col h-full w-full">
    <MainChatHeader />
    <ChatBody />
    <InputToolbar />
  </div>
);

export default MainChat;

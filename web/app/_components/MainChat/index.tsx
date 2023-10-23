import ChatBody from "../ChatBody";
import InputToolbar from "../InputToolbar";

const MainChat: React.FC = () => (
  <div className="flex h-full w-full flex-col">
    <ChatBody />
    <InputToolbar />
  </div>
)

export default MainChat

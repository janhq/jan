import { showingAdvancedPromptAtom } from "@/_helpers/JotaiWrapper";
import ChatBody from "../ChatBody";
import InputToolbar from "../InputToolbar";
import MainChatHeader from "../MainChatHeader";
import { useAtomValue } from "jotai";

const MainChat: React.FC = () => {
  const showingAdvancedPrompt = useAtomValue(showingAdvancedPromptAtom);

  return (
    <div className="flex flex-col h-full w-full">
      <MainChatHeader />
      <ChatBody />
      {showingAdvancedPrompt ? null : <InputToolbar />}
    </div>
  );
};

export default MainChat;

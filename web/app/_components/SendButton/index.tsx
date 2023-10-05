import { currentPromptAtom } from "@/_helpers/JotaiWrapper";
import { currentConvoStateAtom } from "@/_helpers/atoms/Conversation.atom";
import useSendChatMessage from "@/_hooks/useSendChatMessage";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { useAtom, useAtomValue } from "jotai";

const SendButton: React.FC = () => {
  const [currentPrompt] = useAtom(currentPromptAtom);
  const currentConvoState = useAtomValue(currentConvoStateAtom);

  const { sendChatMessage } = useSendChatMessage();
  const isWaitingForResponse = currentConvoState?.waitingForResponse ?? false;
  const disabled = currentPrompt.trim().length === 0 || isWaitingForResponse;

  const enabledStyle = {
    backgroundColor: "#FACA15",
  };

  const disabledStyle = {
    backgroundColor: "#F3F4F6",
  };

  return (
    <button
      onClick={sendChatMessage}
      style={disabled ? disabledStyle : enabledStyle}
      type="submit"
      className="p-2 gap-2.5 inline-flex items-center rounded-xl text-sm font-semibold shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      <ArrowRightIcon width={16} height={16} />
    </button>
  );
};

export default SendButton;

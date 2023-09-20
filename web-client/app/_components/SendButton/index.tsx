import {
  currentConvoStateAtom,
  currentPromptAtom,
} from "@/_helpers/JotaiWrapper";
// import useSendChatMessage from "@/_hooks/useSendChatMessage";
import { useAtomValue } from "jotai";
import Image from "next/image";

const SendButton: React.FC = () => {
  const currentPrompt = useAtomValue(currentPromptAtom);
  const currentConvoState = useAtomValue(currentConvoStateAtom);
  // const { sendChatMessage } = useSendChatMessage();
  const sendChatMessage = () => {}
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
      className="p-2 gap-[10px] inline-flex items-center rounded-[12px] text-sm font-semibold shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      <Image src={"icons/ic_arrowright.svg"} width={24} height={24} alt="" />
    </button>
  );
};

export default SendButton;

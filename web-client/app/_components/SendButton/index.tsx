import {
  addNewMessageAtom,
  currentConvoStateAtom,
  currentPromptAtom,
  currentConversationAtom,
  showingTyping,
} from "@/_helpers/JotaiWrapper";
import { RawMessage, toChatMessage } from "@/_models/ChatMessage";
import { execute, executeSerial } from "@/_services/pluginService";
// import useSendChatMessage from "@/_hooks/useSendChatMessage";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import Image from "next/image";
import { DataService, InfereceService } from "../../../shared/coreService";

const SendButton: React.FC = () => {
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);
  const currentConvo = useAtomValue(currentConversationAtom);
  const currentConvoState = useAtomValue(currentConvoStateAtom);
  const addNewMessage = useSetAtom(addNewMessageAtom);
  const [, setIsTyping] = useAtom(showingTyping);
  // const { sendChatMessage } = useSendChatMessage();
  const sendChatMessage = async () => {
    setIsTyping(true);
    setCurrentPrompt("");
    const prompt = currentPrompt.trim();
    const newMessage: RawMessage = {
      conversation_id: parseInt(currentConvo?.id ?? "0") ?? 0,
      message: prompt,
      user: "user",
      created_at: new Date().toISOString(),
    };
    await execute(DataService.CREATE_MESSAGE, newMessage);
    addNewMessage(await toChatMessage(newMessage));
    const resp = await executeSerial(InfereceService.INFERENCE, prompt);

    const newResponse: RawMessage = {
      conversation_id: parseInt(currentConvo?.id ?? "0") ?? 0,
      message: resp,
      user: "assistant",
      created_at: new Date().toISOString(),
    };
    await execute(DataService.CREATE_MESSAGE, newResponse);
    addNewMessage(await toChatMessage(newResponse));
    setIsTyping(false);
  };
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

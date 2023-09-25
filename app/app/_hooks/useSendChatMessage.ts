import {
  addNewMessageAtom,
  currentConversationAtom,
  currentPromptAtom,
  showingTyping,
} from "@/_helpers/JotaiWrapper";

import { useAtom, useAtomValue, useSetAtom } from "jotai";

import { DataService, InfereceService } from "../../shared/coreService";
import { RawMessage, toChatMessage } from "@/_models/ChatMessage";
import { executeSerial } from "@/_services/pluginService";

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom);

  const addNewMessage = useSetAtom(addNewMessageAtom);
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);
  const [, setIsTyping] = useAtom(showingTyping);
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
    const id = await executeSerial(DataService.CREATE_MESSAGE, newMessage);
    newMessage.id = id;

    addNewMessage(await toChatMessage(newMessage));
    const resp = await executeSerial(InfereceService.INFERENCE, prompt);

    const newResponse: RawMessage = {
      conversation_id: parseInt(currentConvo?.id ?? "0") ?? 0,
      message: resp,
      user: "assistant",
      created_at: new Date().toISOString(),
    };
    const respId = await executeSerial(DataService.CREATE_MESSAGE, newResponse);
    newResponse.id = respId;
    addNewMessage(await toChatMessage(newResponse));
    setIsTyping(false);
  };
  return {
    sendChatMessage,
  };
}

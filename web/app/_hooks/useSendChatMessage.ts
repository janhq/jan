import { currentPromptAtom } from "@/_helpers/JotaiWrapper";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { DataService, EventName, events } from "@janhq/plugin-core";
import { RawMessage, toChatMessage } from "@/_models/ChatMessage";
import { executeSerial } from "@/_services/pluginService";
import { addNewMessageAtom } from "@/_helpers/atoms/ChatMessage.atom";
import { currentConversationAtom } from "@/_helpers/atoms/Conversation.atom";

export default function useSendChatMessage() {
  const currentConvo = useAtomValue(currentConversationAtom);
  const addNewMessage = useSetAtom(addNewMessageAtom);

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);

  const sendChatMessage = async () => {
    setCurrentPrompt("");
    const prompt = currentPrompt.trim();
    const newMessage: RawMessage = {
      conversationId: currentConvo?._id,
      message: prompt,
      user: "user",
      createdAt: new Date().toISOString(),
    };
    const id = await executeSerial(DataService.CreateMessage, newMessage);
    newMessage._id = id;

    const newChatMessage = toChatMessage(newMessage);
    addNewMessage(newChatMessage);
    events.emit(EventName.OnNewMessageRequest, newMessage);
  };

  return {
    sendChatMessage,
  };
}

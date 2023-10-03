"use client";

import { currentPromptAtom } from "@/_helpers/JotaiWrapper";
import { getActiveConvoIdAtom } from "@/_helpers/atoms/Conversation.atom";
import { selectedModelAtom } from "@/_helpers/atoms/Model.atom";
import useCreateConversation from "@/_hooks/useCreateConversation";
import useInitModel from "@/_hooks/useInitModel";
import useSendChatMessage from "@/_hooks/useSendChatMessage";
import { useAtom, useAtomValue } from "jotai";
import { ChangeEvent } from "react";

const BasicPromptInput: React.FC = () => {
  const activeConversationId = useAtomValue(getActiveConvoIdAtom);
  const selectedModel = useAtomValue(selectedModelAtom);
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);
  const { sendChatMessage } = useSendChatMessage();
  const { requestCreateConvo } = useCreateConversation();

  const { initModel } = useInitModel();

  const handleMessageChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentPrompt(event.target.value);
  };

  const handleKeyDown = async (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter") {
      if (!event.shiftKey) {
        if (activeConversationId) {
          event.preventDefault();
          sendChatMessage();
        } else {
          if (!selectedModel) {
            console.log("No model selected");
            return;
          }

          await requestCreateConvo(selectedModel);
          await initModel(selectedModel);
          sendChatMessage();
        }
      }
    }
  };

  return (
    <textarea
      onKeyDown={handleKeyDown}
      value={currentPrompt}
      onChange={handleMessageChange}
      rows={2}
      name="comment"
      id="comment"
      className="overflow-hidden block w-full scroll resize-none border-0 bg-transparent py-1.5 text-gray-900 transition-height duration-200 placeholder:text-gray-400 sm:text-sm sm:leading-6 dark:text-white"
      placeholder="Add your comment..."
    />
  );
};

export default BasicPromptInput;

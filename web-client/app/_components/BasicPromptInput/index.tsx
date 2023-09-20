"use client";

import { currentPromptAtom } from "@/_helpers/JotaiWrapper";
// import useSendChatMessage from "@/_hooks/useSendChatMessage";
import { useAtom } from "jotai";

const BasicPromptInput: React.FC = () => {
  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);
  // const { sendChatMessage } = useSendChatMessage();
  const sendChatMessage = () => {};

  const handleMessageChange = (event: any) => {
    setCurrentPrompt(event.target.value);
  };

  const handleKeyDown = (event: any) => {
    if (event.key === "Enter") {
      if (!event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
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

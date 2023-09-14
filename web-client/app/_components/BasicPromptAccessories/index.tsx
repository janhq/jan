"use client";

import {
  currentConversationAtom,
  showingAdvancedPromptAtom,
} from "@/_helpers/JotaiWrapper";
import { useAtomValue, useSetAtom } from "jotai";
import SecondaryButton from "../SecondaryButton";
import SendButton from "../SendButton";
import { ProductType } from "@/_models/Product";

const BasicPromptAccessories: React.FC = () => {
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom);
  const currentConversation = useAtomValue(currentConversationAtom);

  const shouldShowAdvancedPrompt =
    currentConversation?.product.type === ProductType.ControlNet;

  return (
    <div
      style={{
        backgroundColor: "#F8F8F8",
        borderWidth: 1,
        borderColor: "#D1D5DB",
      }}
      className="flex justify-between py-2 pl-3 pr-2 rounded-b-lg"
    >
      {shouldShowAdvancedPrompt && (
        <SecondaryButton
          title="Advanced"
          onClick={() => setShowingAdvancedPrompt(true)}
        />
      )}
      <div className="flex justify-end items-center space-x-1 w-full pr-3" />
      {!shouldShowAdvancedPrompt && <SendButton />}
    </div>
  );
};

export default BasicPromptAccessories;

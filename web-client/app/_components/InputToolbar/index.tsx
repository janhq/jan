"use client";

import BasicPromptInput from "../BasicPromptInput";
import BasicPromptAccessories from "../BasicPromptAccessories";
import { showingAdvancedPromptAtom } from "@/_helpers/JotaiWrapper";
import { useAtomValue } from "jotai";

const InputToolbar: React.FC = () => {
  const showingAdvancedPrompt = useAtomValue(showingAdvancedPromptAtom);

  if (showingAdvancedPrompt) {
    return <div />;
  }

  return (
    <div className="mx-3 mb-3 flex-none overflow-hidden shadow-sm ring-1 ring-inset ring-gray-300 rounded-lg dark:bg-gray-800">
      <BasicPromptInput />
      <BasicPromptAccessories />
    </div>
  );
};

export default InputToolbar;

import React from "react";
import { useSetAtom } from "jotai";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import { showingAdvancedPromptAtom } from "@/_atoms/ModalAtoms";

const BasicPromptButton: React.FC = () => {
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom);

  return (
    <button
      onClick={() => setShowingAdvancedPrompt(false)}
      className="flex items-center mx-2 mt-3 mb-[10px] flex-none gap-1 text-xs leading-[18px] text-[#6B7280]"
    >
      <ChevronLeftIcon width={20} height={20} />
      <span className="font-semibold text-gray-500 text-xs">BASIC PROMPT</span>
    </button>
  );
};

export default React.memo(BasicPromptButton);

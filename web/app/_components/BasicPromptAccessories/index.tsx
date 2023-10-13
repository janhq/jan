"use client";

import { useSetAtom } from "jotai";
import { FaceSmileIcon } from "@heroicons/react/24/outline";
import SendButton from "../SendButton";
import { showingAdvancedPromptAtom } from "@/_helpers/atoms/Modal.atom";

const BasicPromptAccessories: React.FC = () => {
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom);

  const shouldShowAdvancedPrompt = false;

  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-between py-2 pl-3 pr-2">
      {/* Emoji */}
      <div className="flex items-center space-x-5">
        <div className="flex items-center">
          <button
            type="button"
            className="-m-2.5 flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:text-gray-500"
          >
            <FaceSmileIcon className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Attach a file</span>
          </button>
        </div>
      </div>
      {/* send buton */}
      <div className="flex-shrink-0">
        <SendButton />
      </div>
    </div>
  );
};

export default BasicPromptAccessories;

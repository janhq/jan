"use client";

import BasicPromptInput from "../BasicPromptInput";
import BasicPromptAccessories from "../BasicPromptAccessories";
import { useAtomValue } from "jotai";
import { showingAdvancedPromptAtom } from "@/_helpers/atoms/Modal.atom";
import SecondaryButton from "../SecondaryButton";
import { Fragment } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import useCreateConversation from "@/_hooks/useCreateConversation";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";
import { showingTyping } from "@/_helpers/JotaiWrapper";
import LoadingIndicator from "../LoadingIndicator";

const InputToolbar: React.FC = () => {
  const showingAdvancedPrompt = useAtomValue(showingAdvancedPromptAtom);
  const currentProduct = useAtomValue(currentProductAtom);
  const { requestCreateConvo } = useCreateConversation();
  const isTyping = useAtomValue(showingTyping);

  if (showingAdvancedPrompt) {
    return <div />;
  }

  // TODO: implement regenerate
  // const onRegenerateClick = () => {};

  const onNewConversationClick = () => {
    if (currentProduct) {
      requestCreateConvo(currentProduct);
    }
  };

  return (
    <Fragment>
      <div className="flex justify-between gap-2 mr-3 my-2">
        <div className="h-6">
          {isTyping && (
            <div className="my-2" key="indicator">
              <LoadingIndicator />
            </div>
          )}{" "}
        </div>

        {/* <SecondaryButton title="Regenerate" onClick={onRegenerateClick} /> */}
        <SecondaryButton
          onClick={onNewConversationClick}
          title="New Conversation"
          icon={<PlusIcon width={16} height={16} />}
        />
      </div>
      <div className="mx-3 mb-3 flex-none overflow-hidden shadow-sm ring-1 ring-inset ring-gray-300 rounded-lg dark:bg-gray-800">
        <BasicPromptInput />
        <BasicPromptAccessories />
      </div>
    </Fragment>
  );
};

export default InputToolbar;

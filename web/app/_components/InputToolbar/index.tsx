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

const InputToolbar: React.FC = () => {
  const showingAdvancedPrompt = useAtomValue(showingAdvancedPromptAtom);
  const currentProduct = useAtomValue(currentProductAtom);
  const { requestCreateConvo } = useCreateConversation();

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
      <div className="flex justify-end gap-2 mr-3 my-2">
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

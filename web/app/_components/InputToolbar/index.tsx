"use client";

import BasicPromptInput from "../BasicPromptInput";
import BasicPromptAccessories from "../BasicPromptAccessories";
import { useAtomValue } from "jotai";
import { showingAdvancedPromptAtom } from "@/_helpers/atoms/Modal.atom";
import SecondaryButton from "../SecondaryButton";
import { Fragment } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import useCreateConversation from "@/_hooks/useCreateConversation";
import { activeAssistantModelAtom } from "@/_helpers/atoms/Model.atom";
import { currentConvoStateAtom } from "@/_helpers/atoms/Conversation.atom";

const InputToolbar: React.FC = () => {
  const showingAdvancedPrompt = useAtomValue(showingAdvancedPromptAtom);
  const activeModel = useAtomValue(activeAssistantModelAtom);
  const { requestCreateConvo } = useCreateConversation();
  const currentConvoState = useAtomValue(currentConvoStateAtom);

  if (showingAdvancedPrompt) {
    return <div />;
  }

  // TODO: implement regenerate
  // const onRegenerateClick = () => {};

  const onNewConversationClick = () => {
    if (activeModel) {
      requestCreateConvo(activeModel);
    }
  };

  return (
    <Fragment>
      {currentConvoState?.error && (
        <div className="flex flex-row justify-center">
          <span className="mx-5 my-2 text-red-500 text-sm">
            {currentConvoState?.error?.toString()}
          </span>
        </div>
      )}
      <div className="flex justify-center gap-2 my-3">
        {/* <SecondaryButton title="Regenerate" onClick={onRegenerateClick} /> */}
        <SecondaryButton
          onClick={onNewConversationClick}
          title="New Conversation"
          icon={<PlusIcon width={16} height={16} />}
        />
      </div>
      {/* My text input */}
      <div className="flex items-start space-x-4 mx-12 md:mx-32 2xl:mx-64 mb-5">
        <div className="min-w-0 flex-1 relative">
          <BasicPromptInput />
          <BasicPromptAccessories />
        </div>
      </div>
    </Fragment>
  );
};

export default InputToolbar;

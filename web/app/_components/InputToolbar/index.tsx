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
import LoadingIndicator from "../LoadingIndicator";
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
      <div className="flex justify-between gap-2 mr-3 my-2">
        <div className="h-6 space-x-5">
          {currentConvoState?.waitingForResponse === true && (
            <div className="ml-1 my-2" key="indicator">
              <LoadingIndicator />
            </div>
          )}
          {!currentConvoState?.waitingForResponse &&
            currentConvoState?.error && (
              <div className="flex flex-row justify-center">
                <span className="mx-5 my-2 text-red-500 text-sm">
                  {currentConvoState?.error?.toString()}
                </span>
              </div>
            )}
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

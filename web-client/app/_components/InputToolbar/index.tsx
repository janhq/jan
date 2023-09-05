import SendButton from "../SendButton";
import { ChangeEvent, useEffect, useState } from "react";
import { useStore } from "@/_models/RootStore";
import { AiModelType } from "@/_models/Product";
import Image from "next/image";
import { observer } from "mobx-react-lite";
import useGetCurrentUser from "@/_hooks/useGetCurrentUser";
import useSignIn from "@/_hooks/useSignIn";
import { useMutation } from "@apollo/client";
import {
  CreateMessageDocument,
  CreateMessageMutation,
  GenerateImageMutation,
  GenerateImageDocument,
} from "@/graphql";

type Props = {
  prefillPrompt: string;
};

export const InputToolbar: React.FC<Props> = observer(({ prefillPrompt }) => {
  const { historyStore } = useStore();
  const [text, setText] = useState(prefillPrompt);
  const { user } = useGetCurrentUser();
  const { signInWithKeyCloak } = useSignIn();

  const [createMessageMutation] = useMutation<CreateMessageMutation>(
    CreateMessageDocument
  );

  const [imageGenerationMutation] = useMutation<GenerateImageMutation>(
    GenerateImageDocument
  );

  useEffect(() => {
    setText(prefillPrompt);
  }, [prefillPrompt]);

  const handleMessageChange = (event: any) => {
    setText(event.target.value);
  };

  const onSubmitClick = () => {
    if (!user) {
      signInWithKeyCloak();
      return;
    }

    if (text.trim().length === 0) return;
    historyStore.sendMessage(
      createMessageMutation,
      imageGenerationMutation,
      text,
      user.id,
      user.displayName,
      user.avatarUrl
    );
    setText("");
  };

  const handleKeyDown = (event: any) => {
    if (event.key === "Enter") {
      if (!event.shiftKey) {
        event.preventDefault();
        onSubmitClick();
      }
    }
  };

  let shouldDisableSubmitButton = false;
  if (historyStore.getActiveConversation()?.isWaitingForModelResponse) {
    shouldDisableSubmitButton = true;
  }
  if (text.length === 0) {
    shouldDisableSubmitButton = true;
  }
  const onAdvancedPrompt = () => {
    historyStore.toggleAdvancedPrompt();
  };

  const handleResize = (event: ChangeEvent<HTMLTextAreaElement>) => {
    event.target.style.height = "auto";
    event.target.style.height = event.target.scrollHeight + "px";
  };

  const shouldShowAdvancedPrompt =
    historyStore.getActiveConversation()?.product?.type ===
      AiModelType.ControlNet ?? false;

  return (
    <div
      className={`${
        historyStore.showAdvancedPrompt ? "hidden" : "block"
      } mb-3 flex-none overflow-hidden w-full shadow-sm ring-1 ring-inset ring-gray-300 rounded-lg dark:bg-gray-800`}
    >
      <div className="overflow-hidden">
        <label htmlFor="comment" className="sr-only">
          Add your comment
        </label>
        <textarea
          onKeyDown={handleKeyDown}
          value={text}
          onChange={handleMessageChange}
          onInput={handleResize}
          rows={2}
          name="comment"
          id="comment"
          className="block w-full scroll resize-none border-0 bg-transparent py-1.5 text-gray-900 transition-height duration-200 placeholder:text-gray-400 sm:text-sm sm:leading-6 dark:text-white"
          placeholder="Add your comment..."
        />
      </div>
      <div
        style={{
          backgroundColor: "#F8F8F8",
          borderWidth: 1,
          borderColor: "#D1D5DB",
        }}
        className="flex justify-between py-2 pl-3 pr-2 rounded-b-lg"
      >
        {shouldShowAdvancedPrompt && (
          <button
            onClick={onAdvancedPrompt}
            className="flex items-center gap-1 py-[1px]"
          >
            <Image
              src={"/icons/ic_setting.svg"}
              width={20}
              height={20}
              alt=""
            />
            <span className="text-sm leading-5 text-gray-600">Advanced</span>
          </button>
        )}
        <div className="flex justify-end items-center space-x-1 w-full pr-3" />
        <div className="flex-shrink-0">
          {!shouldShowAdvancedPrompt && (
            <SendButton
              onClick={onSubmitClick}
              disabled={shouldDisableSubmitButton}
            />
          )}
        </div>
      </div>
    </div>
  );
});

import React from "react";
import JanImage from "../JanImage";
import { useAtomValue, useSetAtom } from "jotai";
import Image from "next/image";
import { Conversation } from "@/_models/Conversation";
import { ModelManagementService } from "@janhq/plugin-core";
import { executeSerial } from "../../../../electron/core/plugin-manager/execution/extension-manager";
import {
  conversationStatesAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  updateConversationErrorAtom,
  updateConversationWaitingForResponseAtom,
} from "@/_helpers/atoms/Conversation.atom";
import {
  setMainViewStateAtom,
  MainViewState,
} from "@/_helpers/atoms/MainView.atom";
import useInitModel from "@/_hooks/useInitModel";

type Props = {
  conversation: Conversation;
  avatarUrl?: string;
  name: string;
  updatedAt?: string;
};

const HistoryItem: React.FC<Props> = ({
  conversation,
  avatarUrl,
  name,
  updatedAt,
}) => {
  const setMainViewState = useSetAtom(setMainViewStateAtom);
  const conversationStates = useAtomValue(conversationStatesAtom);
  const activeConvoId = useAtomValue(getActiveConvoIdAtom);
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const updateConvWaiting = useSetAtom(
    updateConversationWaitingForResponseAtom
  );
  const updateConvError = useSetAtom(updateConversationErrorAtom);
  const isSelected = activeConvoId === conversation._id;

  const { initModel } = useInitModel();

  const onClick = async () => {
    const model = await executeSerial(
      ModelManagementService.GetModelById,
      conversation.modelId
    );

    if (conversation._id) updateConvWaiting(conversation._id, true);
    initModel(model).then((res: any) => {
      if (conversation._id) updateConvWaiting(conversation._id, false);

      if (res?.error && conversation._id) {
        updateConvError(conversation._id, res.error);
      }
    });

    if (activeConvoId !== conversation._id) {
      setMainViewState(MainViewState.Conversation);
      setActiveConvoId(conversation._id);
    }
  };

  const backgroundColor = isSelected
    ? "bg-gray-100 dark:bg-gray-700"
    : "bg-white dark:bg-gray-500";

  let rightImageUrl: string | undefined;
  if (conversationStates[conversation._id ?? ""]?.waitingForResponse === true) {
    rightImageUrl = "icons/loading.svg";
  }

  return (
    <button
      className={`flex flex-row mx-1 items-center gap-2.5 rounded-lg p-2 ${backgroundColor} hover:bg-hover-light`}
      onClick={onClick}
    >
      <Image
        width={36}
        height={36}
        src={avatarUrl ?? "icons/app_icon.svg"}
        className="w-9 aspect-square rounded-full"
        alt=""
      />
      <div className="flex flex-col justify-between text-sm leading-[20px] w-full">
        <div className="flex flex-row items-center justify-between">
          <span className="text-gray-900 text-left">{name}</span>
          <span className="text-xs leading-[13px] tracking-[-0.4px] text-gray-400">
            {updatedAt && new Date(updatedAt).toDateString()}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="flex-1">
            <span className="text-gray-400 hidden-text text-left">
              {conversation?.message ?? (
                <span>
                  No new message
                  <br className="h-5 block" />
                </span>
              )}
            </span>
          </div>
          <>
            {rightImageUrl != null ? (
              <JanImage
                imageUrl={rightImageUrl ?? ""}
                className="rounded"
                width={24}
                height={24}
              />
            ) : undefined}
          </>
        </div>
      </div>
    </button>
  );
};

export default HistoryItem;

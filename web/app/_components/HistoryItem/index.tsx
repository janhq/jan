import React from "react";
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
import { displayDate } from "@/_utils/datetime";

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

  const description = conversation?.lastMessage ?? "No new message";

  return (
    <li
      role="button"
      className={`flex flex-row ml-3 mr-2 rounded p-3 ${backgroundColor} hover:bg-hover-light`}
      onClick={onClick}
    >
      <div className="w-8 h-8">
        <Image
          width={32}
          height={32}
          src={avatarUrl ?? "icons/app_icon.svg"}
          className="aspect-square rounded-full"
          alt=""
        />
      </div>

      <div className="flex flex-col ml-2 flex-1">
        {/* title */}
        <div className="flex">
          <span className="flex-1 text-gray-900 line-clamp-1">{name}</span>
          <span className="text-xs leading-5 text-gray-500 line-clamp-1">
            {updatedAt && displayDate(new Date(updatedAt).getTime())}
          </span>
        </div>

        {/* description */}
        <span className="mt-1 text-gray-400 line-clamp-2">{description}</span>
      </div>
    </li>
  );
};

export default HistoryItem;

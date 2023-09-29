import React from "react";
import JanImage from "../JanImage";
import {
  MainViewState,
  activeModel,
  conversationStatesAtom,
  currentProductAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  setMainViewStateAtom,
} from "@/_helpers/JotaiWrapper";
import { useAtomValue, useSetAtom } from "jotai";
import Image from "next/image";
import { Conversation } from "@/_models/Conversation";
import { DataService, InfereceService } from "../../../shared/coreService";
import {
  execute,
  executeSerial,
} from "../../../../electron/core/plugin-manager/execution/extension-manager";

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
  const isSelected = activeConvoId === conversation.id;
  const setActiveModel = useSetAtom(activeModel);
  const setActiveProduct = useSetAtom(currentProductAtom);
  const onClick = async () => {
    const convoModel = await executeSerial(
      DataService.GET_MODEL_BY_ID,
      conversation.model_id
    );
    if (!convoModel) {
      alert(
        `Model ${conversation.model_id} not found! Please re-download the model first.`
      );
    } else {
      setActiveProduct(convoModel)
      executeSerial(InfereceService.INIT_MODEL, convoModel)
        .then(() => console.info(`Init model success`))
        .catch((err) => console.log(`Init model error ${err}`));
      setActiveModel(convoModel.name);
    }
    if (activeConvoId !== conversation.id) {
      setMainViewState(MainViewState.Conversation);
      setActiveConvoId(conversation.id);
    }
  };

  const backgroundColor = isSelected
    ? "bg-gray-100 dark:bg-gray-700"
    : "bg-white dark:bg-gray-500";

  let rightImageUrl: string | undefined;
  if (conversationStates[conversation.id ?? ""]?.waitingForResponse === true) {
    rightImageUrl = "icons/loading.svg";
  }

  return (
    <button
      className={`flex flex-row mx-1 items-center gap-[10px] rounded-lg p-2 ${backgroundColor} hover:bg-hover-light`}
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
          <span className="text-[11px] leading-[13px] tracking-[-0.4px] text-gray-400">
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

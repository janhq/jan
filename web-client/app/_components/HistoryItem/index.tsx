import React from "react";
import JanImage from "../JanImage";
import { displayDate } from "@/_utils/datetime";
import {
  conversationStatesAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
} from "@/_helpers/JotaiWrapper";
import { useAtomValue, useSetAtom } from "jotai";
import { ProductType } from "@/_models/Product";
import Image from "next/image";
import { Conversation } from "@/_models/Conversation";

type Props = {
  conversation: Conversation;
  avatarUrl: string;
  name: string;
  updatedAt?: number;
};

const HistoryItem: React.FC<Props> = ({
  conversation,
  avatarUrl,
  name,
  updatedAt,
}) => {
  const conversationStates = useAtomValue(conversationStatesAtom);
  const activeConvoId = useAtomValue(getActiveConvoIdAtom);
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const isSelected = activeConvoId === conversation.id;

  const onClick = () => {
    if (activeConvoId !== conversation.id) {
      setActiveConvoId(conversation.id);
    }
  };

  const backgroundColor = isSelected
    ? "bg-gray-100 dark:bg-gray-700"
    : "bg-white dark:bg-gray-500";

  let rightImageUrl: string | undefined;
  if (conversationStates[conversation.id]?.waitingForResponse === true) {
    rightImageUrl = "/icons/loading.svg";
  } else if (
    conversation &&
    conversation.product.type === ProductType.GenerativeArt &&
    conversation.lastImageUrl &&
    conversation.lastImageUrl.trim().startsWith("https://")
  ) {
    rightImageUrl = conversation.lastImageUrl;
  }

  return (
    <button
      className={`flex flex-row mx-1 items-center gap-[10px] rounded-lg p-2 ${backgroundColor}`}
      onClick={onClick}
    >
      <Image
        width={36}
        height={36}
        src={avatarUrl}
        className="w-9 aspect-square rounded-full"
        alt=""
      />
      <div className="flex flex-col justify-between text-sm leading-[20px] w-full">
        <div className="flex flex-row items-center justify-between">
          <span className="text-gray-900 text-left">{name}</span>
          <span className="text-[11px] leading-[13px] tracking-[-0.4px] text-gray-400">
            {updatedAt && displayDate(updatedAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="flex-1">
            <span className="text-gray-400 hidden-text text-left">
              {conversation?.lastTextMessage || <br className="h-5 block" />}
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

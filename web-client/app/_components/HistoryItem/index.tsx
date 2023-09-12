import { AiModelType } from "@/_models/Product";
import { useStore } from "@/_models/RootStore";
import { observer } from "mobx-react-lite";
import React from "react";
import JanImage from "../JanImage";
import { displayDate } from "@/_utils/datetime";
import Image from "next/image";



type Props = {
  conversationId: string;
  avatarUrl: string;
  name: string;
  updatedAt?: number;
};

const HistoryItem: React.FC<Props> = observer(
  ({ conversationId, avatarUrl, name, updatedAt }) => {
    const { historyStore } = useStore();
    const send = true; // TODO store this in mobx
    const onClick = () => {
      historyStore.setActiveConversationId(conversationId);
    };

    const conversation = historyStore.getConversationById(conversationId);
    const isSelected = historyStore.activeConversationId === conversationId;
    const backgroundColor = isSelected
      ? "bg-white dark:bg-gray-700"
      : "bg-gray-200 dark:bg-gray-500";

    let rightImageUrl: string | undefined;
    if (conversation && conversation.isWaitingForModelResponse) {
      rightImageUrl = "/icons/loading.svg";
    } else if (
      conversation &&
      conversation.product.type === AiModelType.GenerativeArt &&
      conversation.lastImageUrl &&
      conversation.lastImageUrl.trim().startsWith("https://")
    ) {
      rightImageUrl = conversation.lastImageUrl;
    }

    return (
      <button
        type="button"
        className={`flex bg-white hover:bg-gray-100 flex-row items-center gap-[10px] rounded-lg p-4 ${backgroundColor}`}
        onClick={onClick}
      >
        <div className="flex h-6 aspect-square">
        <svg fill="none" stroke="#A3A3A3" stroke-width="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"></path>
</svg>
        </div>
       {/*  <img
          className="rounded-full aspect-square object-cover"
          src={avatarUrl}
          width={36}
          alt=""
        /> */}
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
            {send ? (
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
            ) : (
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            )}
          </div>
        </div>
      </button>
    );
  }
);

export default HistoryItem;

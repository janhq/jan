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
      ? "bg-gray-100 dark:bg-gray-700"
      : "bg-white dark:bg-gray-500";

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
        className={`flex flex-row items-center gap-[10px] rounded-lg p-2 ${backgroundColor}`}
        onClick={onClick}
      >
        <img
          className="rounded-full aspect-square object-cover"
          src={avatarUrl}
          width={36}
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

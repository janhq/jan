import { useStore } from "@/_models/RootStore";
import Image from "next/image";
import React from "react";

type Props = {
  imageUrl: string;
  isSelected: boolean;
  conversationId: string;
};

const CompactHistoryItem: React.FC<Props> = ({
  imageUrl,
  isSelected,
  conversationId,
}) => {
  const { historyStore } = useStore();
  const onClick = () => {
    historyStore.setActiveConversationId(conversationId);
  };

  return (
    <button
      onClick={onClick}
      className={`${
        isSelected ? "bg-gray-100" : "bg-transparent"
      } p-2 rounded-lg`}
    >
      <Image
        className="rounded-full"
        src={imageUrl}
        width={36}
        height={36}
        alt=""
      />
    </button>
  );
};

export default React.memo(CompactHistoryItem);

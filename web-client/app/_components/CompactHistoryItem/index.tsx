import { activeConversationIdAtom } from "@/_atoms/ConversationAtoms";
import { useAtom } from "jotai";
import Image from "next/image";

type Props = {
  imageUrl: string;
  conversationId: string;
};

const CompactHistoryItem: React.FC<Props> = ({ imageUrl, conversationId }) => {
  const [activeId, setActiveId] = useAtom(activeConversationIdAtom);

  const isSelected = activeId === conversationId;

  return (
    <button
      onClick={() => setActiveId(conversationId)}
      className={`${
        isSelected ? "bg-gray-100" : "bg-transparent"
      } w-14 h-14 rounded-lg hover:bg-hover-light`}
    >
      <Image
        className="rounded-full mx-auto"
        src={imageUrl}
        width={36}
        height={36}
        alt=""
      />
    </button>
  );
};

export default CompactHistoryItem;

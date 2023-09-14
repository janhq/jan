import { useAtomValue } from "jotai";
import CompactHistoryItem from "../CompactHistoryItem";
import { conversationsAtom } from "@/_atoms/ConversationAtoms";

const CompactHistoryList: React.FC = () => {
  const conversations = useAtomValue(conversationsAtom);

  return (
    <div className="flex flex-col flex-1 gap-1 mt-3">
      {conversations.map(({ id, product }) => (
        <CompactHistoryItem
          key={id}
          conversationId={id}
          imageUrl={product.avatarUrl ?? ""}
        />
      ))}
    </div>
  );
};

export default CompactHistoryList;

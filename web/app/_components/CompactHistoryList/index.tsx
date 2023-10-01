import { useAtomValue } from "jotai";
import CompactHistoryItem from "../CompactHistoryItem";
import { userConversationsAtom } from "@/_helpers/JotaiWrapper";

const CompactHistoryList: React.FC = () => {
  const conversations = useAtomValue(userConversationsAtom);

  return (
    <div className="flex flex-col flex-1 gap-1 mt-3">
      {conversations.map(({ id, image }) => (
        <CompactHistoryItem
          key={id}
          conversationId={id ?? ""}
          imageUrl={image ?? ""}
        />
      ))}
    </div>
  );
};

export default CompactHistoryList;

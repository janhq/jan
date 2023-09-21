import HistoryItem from "../HistoryItem";
import { useEffect, useState } from "react";
import ExpandableHeader from "../ExpandableHeader";
import { useAtomValue } from "jotai";
import { searchAtom, userConversationsAtom } from "@/_helpers/JotaiWrapper";
import useGetUserConversations from "@/_hooks/useGetUserConversations";
import HistoryEmpty from "../HistoryEmpty";

const HistoryList: React.FC = () => {
  const conversations = useAtomValue(userConversationsAtom);
  const searchText = useAtomValue(searchAtom);
  const [expand, setExpand] = useState<boolean>(true);
  const { getUserConversations } = useGetUserConversations();

  useEffect(() => {
    getUserConversations();
  }, []);

  return (
    <div className="flex flex-col flex-grow pt-3 gap-2">
      <ExpandableHeader
        title="CHAT HISTORY"
        expanded={expand}
        onClick={() => setExpand(!expand)}
      />
      <div
        className={`flex flex-col gap-1 mt-1 ${!expand ? "hidden " : "block"}`}
      >
        {conversations.length > 0 ? (
          conversations
            .filter(
              (e) =>
                searchText.trim() === "" ||
                e.name?.toLowerCase().includes(searchText.toLowerCase().trim())
            )
            .map((convo) => (
              <HistoryItem
                key={convo.id}
                conversation={convo}
                avatarUrl={convo.image}
                name={convo.name || "Jan"}
                updatedAt={convo.updated_at ?? ""}
              />
            ))
        ) : (
          <HistoryEmpty/>
        )}
      </div>
    </div>
  );
};

export default HistoryList;

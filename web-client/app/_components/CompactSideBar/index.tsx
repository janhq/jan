"use client"
import { observer } from "mobx-react-lite";
import CompactLogo from "../CompactLogo";
import CompactHistoryItem from "../CompactHistoryItem";
import { useStore } from "@/_models/RootStore";

export const CompactSideBar: React.FC = observer(() => {
  const { historyStore } = useStore();

  const onLogoClick = () => {
    historyStore.clearActiveConversationId();
  };

  return (
    <div
      className={`${
        !historyStore.showAdvancedPrompt ? "hidden" : "block"
      } h-screen border-r border-gray-300 flex flex-col items-center pt-3 gap-3`}
    >
      <CompactLogo onClick={onLogoClick} />
      <div className="flex flex-col gap-1 mx-1 mt-3 overflow-x-hidden">
        {historyStore.conversations.map(({ id, product: aiModel }) => (
          <CompactHistoryItem
            key={id}
            conversationId={id}
            imageUrl={aiModel.avatarUrl ?? ""}
            isSelected={historyStore.activeConversationId === id}
          />
        ))}
      </div>
    </div>
  );
});

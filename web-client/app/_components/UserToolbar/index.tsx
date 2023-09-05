import { observer } from "mobx-react-lite";
import { useStore } from "@/_models/RootStore";

export const UserToolbar: React.FC = observer(() => {
  const { historyStore } = useStore();
  const conversation = historyStore.getActiveConversation();

  const avatarUrl = conversation?.product.avatarUrl ?? "";
  const title = conversation?.product.name ?? "";

  return (
    <div className="flex items-center gap-3 p-1">
      <img
        className="rounded-full aspect-square w-8 h-8"
        src={avatarUrl}
        alt=""
      />
      <span className="flex gap-[2px] leading-6 text-base font-semibold">
        {title}
      </span>
    </div>
  );
});

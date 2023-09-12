import { currentConversationAtom } from "@/_helpers/JotaiWrapper";
import { useAtomValue } from "jotai";

const UserToolbar: React.FC = () => {
  const currentConvo = useAtomValue(currentConversationAtom);

  const avatarUrl = currentConvo?.product.avatarUrl ?? "";
  const title = currentConvo?.product.name ?? "";

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
};

export default UserToolbar;

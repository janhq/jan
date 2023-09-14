"use client";

import { activeConversationAtom } from "@/_atoms/ConversationAtoms";
import { useAtomValue } from "jotai";
import Image from "next/image";

const UserToolbar: React.FC = () => {
  const activeConvo = useAtomValue(activeConversationAtom);

  const avatarUrl = activeConvo?.product.avatarUrl ?? "";
  const title = activeConvo?.product.name ?? "";

  return (
    <div className="flex items-center gap-3 p-1">
      <Image
        className="rounded-full aspect-square w-8 h-8"
        src={avatarUrl}
        alt=""
        width={36}
        height={36}
      />
      <span className="flex gap-[2px] leading-6 text-base font-semibold">
        {title}
      </span>
    </div>
  );
};

export default UserToolbar;

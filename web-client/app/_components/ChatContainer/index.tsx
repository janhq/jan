"use client";

import ModelDetailSideBar from "../ModelDetailSideBar";
import ProductOverview from "../ProductOverview";
import { useAtomValue } from "jotai";
import { ReactNode } from "react";
import { activeConversationIdAtom } from "@/_atoms/ConversationAtoms";

type Props = {
  children: ReactNode;
};

export default function ChatContainer({ children }: Props) {
  const activeConvoId = useAtomValue(activeConversationIdAtom);

  if (!activeConvoId) {
    return <ProductOverview />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {children}
      <ModelDetailSideBar />
    </div>
  );
}

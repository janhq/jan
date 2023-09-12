"use client";

import ModelDetailSideBar from "../ModelDetailSideBar";
import ProductOverview from "../ProductOverview";
import MainChat from "../MainChat";
import { useAtomValue } from "jotai";
import {
  getActiveConvoIdAtom,
  showingProductDetailAtom,
} from "@/_helpers/JotaiWrapper";

const ChatContainer: React.FC = () => {
  const activeConvoId = useAtomValue(getActiveConvoIdAtom);
  const showingProductDetail = useAtomValue(showingProductDetailAtom);

  if (!activeConvoId) {
    return <ProductOverview />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <MainChat />
      {showingProductDetail ? <ModelDetailSideBar /> : null}
    </div>
  );
};

export default ChatContainer;

"use client";

import ModelDetailSideBar from "../ModelDetailSideBar";
import ProductOverview from "../ProductOverview";
import { useAtomValue } from "jotai";
import {
  getActiveConvoIdAtom,
  showingProductDetailAtom,
} from "@/_helpers/JotaiWrapper";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function ChatContainer({ children }: Props) {
  const activeConvoId = useAtomValue(getActiveConvoIdAtom);
  // const showingProductDetail = useAtomValue(showingProductDetailAtom);

  if (!activeConvoId) {
    return <ProductOverview />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {children}
      {/* {showingProductDetail ? <ModelDetailSideBar /> : null} */}
    </div>
  );
}

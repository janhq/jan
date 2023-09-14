"use client";

import { useAtomValue } from "jotai";
import AdvancedPrompt from "../AdvancedPrompt";
import CompactSideBar from "../CompactSideBar";
import LeftSidebar from "../LeftSidebar";
import { showingAdvancedPromptAtom } from "@/_atoms/ModalAtoms";

const LeftContainer: React.FC = () => {
  const isShowingAdvPrompt = useAtomValue(showingAdvancedPromptAtom);

  if (isShowingAdvPrompt) {
    return (
      <div className="flex h-screen">
        <CompactSideBar />
        <AdvancedPrompt />
      </div>
    );
  }

  return <LeftSidebar />;
};

export default LeftContainer;

import React from "react";
import JanImage from "../JanImage";
import { useSetAtom } from "jotai";
import { activeConversationIdAtom } from "@/_atoms/ConversationAtoms";

const CompactLogo: React.FC = () => {
  const setActiveConvoId = useSetAtom(activeConversationIdAtom);

  return (
    <button onClick={() => setActiveConvoId(undefined)}>
      <JanImage imageUrl="/icons/app_icon.svg" width={28} height={28} />
    </button>
  );
};

export default React.memo(CompactLogo);

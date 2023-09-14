import React from "react";
import JanImage from "../JanImage";
import { setActiveConvoIdAtom } from "@/_helpers/JotaiWrapper";
import { useSetAtom } from "jotai";

const CompactLogo: React.FC = () => {
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);

  return (
    <button onClick={() => setActiveConvoId(undefined)}>
      <JanImage imageUrl="/icons/app_icon.svg" width={28} height={28} />
    </button>
  );
};

export default React.memo(CompactLogo);

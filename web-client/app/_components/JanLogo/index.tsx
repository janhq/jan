import { setActiveConvoIdAtom } from "@/_helpers/JotaiWrapper";
import { useSetAtom } from "jotai";
import Image from "next/image";
import React from "react";

const JanLogo: React.FC = () => {
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  return (
    <button
      className="p-3 flex gap-[2px] items-center"
      onClick={() => setActiveConvoId(undefined)}
    >
      <Image src={"icons/app_icon.svg"} width={28} height={28} alt="" />
      <Image src={"icons/Jan.svg"} width={27} height={12} alt="" />
    </button>
  );
};

export default React.memo(JanLogo);

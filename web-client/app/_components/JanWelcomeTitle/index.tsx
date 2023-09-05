import React from "react";
import Image from "next/image";

type Props = {
  title: string;
  description: string;
};

const JanWelcomeTitle: React.FC<Props> = ({ title, description }) => (
  <div className="flex items-center flex-col gap-3">
    <h2 className="text-[22px] leading-7 font-bold">{title}</h2>
    <span className="flex items-center text-xs leading-[18px]">
      Operated by
      <Image src={"/icons/ico_logo.svg"} width={42} height={22} alt="" />
    </span>
    <span className="text-sm text-center font-normal">{description}</span>
  </div>
);

export default React.memo(JanWelcomeTitle);

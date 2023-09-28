import React, { useState } from "react";
import Image from "next/image";

type Props = {
  icon: string;
  title: string;
  expand: boolean;
  onTitleClick: () => void;
};

const TogglableHeader: React.FC<Props> = ({
  icon,
  title,
  expand,
  onTitleClick,
}) => (
  <button className="flex items-center justify-between" onClick={onTitleClick}>
    <div className="flex items-center gap-2">
      <Image src={icon} width={24} height={24} alt="" />
      <span className="text-sm leading-5 font-semibold text-gray-900">
        {title}
      </span>
    </div>
    <Image
      className={`${!expand ? "rotate-180" : "rotate-0"}`}
      src={"icons/unicorn_angle-up.svg"}
      width={24}
      height={24}
      alt=""
    />
  </button>
);

export default React.memo(TogglableHeader);

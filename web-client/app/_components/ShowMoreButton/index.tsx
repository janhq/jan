import React from "react";
import Image from "next/image";

type Props = {
  onClick: () => void;
};

const ShowMoreButton: React.FC<Props> = ({ onClick }) => (
  <button
    className="flex text-xs leading-[18px] text-gray-800 rounded-lg py-2 px-3"
    onClick={onClick}
  >
    Show more
    <Image
      src={"/icons/unicorn_angle-down.svg"}
      width={16}
      height={16}
      alt=""
    />
  </button>
);

export default React.memo(ShowMoreButton);

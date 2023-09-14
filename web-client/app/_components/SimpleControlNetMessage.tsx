import { displayDate } from "@/_utils/datetime";
import Link from "next/link";
import React from "react";
import JanImage from "./JanImage";
import Image from "next/image";

type Props = {
  avatarUrl?: string;
  senderName: string;
  text: string;
  createdAt: number;
  imageUrls: string[];
};

const SimpleControlNetMessage: React.FC<Props> = ({
  avatarUrl = "",
  senderName,
  imageUrls,
  text,
  createdAt,
}) => {
  return (
    <div className="flex items-start gap-2">
      <img
        className="rounded-full"
        src={avatarUrl}
        width={32}
        height={32}
        alt=""
      />
      <div className="flex flex-col gap-1">
        <div className="flex gap-1 justify-start items-baseline">
          <div className="text-[#1B1B1B] text-[13px] font-extrabold leading-[15.2px]">
            {senderName}
          </div>
          <div className="text-[11px] leading-[13.2px] font-medium text-gray-400 ml-2">
            {displayDate(createdAt)}
          </div>
        </div>
        <div className="flex gap-3 flex-col">
          <p className="leading-[20px] whitespace-break-spaces text-[14px] font-normal dark:text-[#d1d5db]">
            {text}
          </p>
          <JanImage
            imageUrl={imageUrls[0]}
            className="w-72 aspect-square rounded-lg"
          />
          <div className="flex flex-row justify-start items-start w-full gap-2">
            <Link
              href={imageUrls[0] || "#"}
              target="_blank_"
              className="flex gap-1 items-center px-2 py-1 bg-[#F3F4F6] rounded-[12px]"
            >
              <Image src="icons/download.svg" width={16} height={16} alt="" />
              <span className="leading-[20px] text-[14px] text-[#111928]">
                Download
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimpleControlNetMessage;

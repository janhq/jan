import React from "react";
import { displayDate } from "@/_utils/datetime";
import { TextCode } from "../TextCode";
import { getMessageCode } from "@/_utils/message";
import Image from "next/image";
import { MessageSenderType } from "@/_models/ChatMessage";

type Props = {
  avatarUrl: string;
  senderName: string;
  createdAt: number;
  senderType: MessageSenderType;
  text?: string;
};

const SimpleTextMessage: React.FC<Props> = ({
  senderName,
  createdAt,
  senderType,
  avatarUrl = "",
  text = "",
}) => {
  const backgroundColor =
    senderType === MessageSenderType.User ? "" : "bg-gray-100";

  return (
    <div
      className={`flex items-start gap-2 px-12 md:px-32 2xl:px-80 ${backgroundColor} py-5`}
    >
      <Image
        className="rounded-full"
        src={avatarUrl}
        width={32}
        height={32}
        alt=""
      />
      <div className="flex flex-col gap-1">
        <div className="flex gap-1 justify-start items-baseline">
          <div className="text-[#1B1B1B] text-sm font-extrabold leading-[15.2px] dark:text-[#d1d5db]">
            {senderName}
          </div>
          <div className="text-xs leading-[13.2px] font-medium text-gray-400">
            {displayDate(createdAt)}
          </div>
        </div>
        {text.includes("```") ? (
          getMessageCode(text).map((item, i) => (
            <div className="flex gap-1 flex-col" key={i}>
              <p className="leading-[20px] whitespace-break-spaces text-sm font-normal dark:text-[#d1d5db]">
                {item.text}
              </p>
              {item.code.trim().length > 0 && <TextCode text={item.code} />}
            </div>
          ))
        ) : (
          <span className="text-sm leading-loose font-normal">{text}</span>
        )}
      </div>
    </div>
  );
};

export default React.memo(SimpleTextMessage);

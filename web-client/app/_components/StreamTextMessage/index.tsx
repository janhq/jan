import React from "react";
import { displayDate } from "@/_utils/datetime";
import { useStore } from "@/_models/RootStore";
import { StreamingText, StreamingTextURL, useTextBuffer } from "nextjs-openai";
import { MessageSenderType } from "@/_models/ChatMessage";
import { Role } from "@/_models/History";

type Props = {
  id?: string;
  avatarUrl?: string;
  senderName: string;
  createdAt: number;
  text?: string;
};

const StreamTextMessage: React.FC<Props> = ({
  senderName,
  createdAt,
  avatarUrl = "",
}) => {
  const [data, setData] = React.useState<any | undefined>();
  const { historyStore } = useStore();
  const conversation = historyStore?.getActiveConversation();

  React.useEffect(() => {
    const messages = conversation?.chatMessages.slice(-5).map((e) => ({
      role:
        e.messageSenderType === MessageSenderType.User
          ? Role.User
          : Role.Assistant,
      content: e.text,
    }));
    setData({
      messages,
      stream: true,
      model: "gpt-3.5-turbo",
      max_tokens: 500,
    });
  }, [conversation]);

  const { buffer, refresh, cancel } = useTextBuffer({
    url: `${process.env.NEXT_PUBLIC_OPENAPI_ENDPOINT}`,
    throttle: 100,
    data,

    options: {
      headers: {
        "Content-Type": "application/json",
      },
    },
  });

  const parsedBuffer = (buffer: String) => {
    try {
      const json = buffer.replace("data: ", "");
      return JSON.parse(json).choices[0].text;
    } catch (e) {
      return "";
    }
  };

  return data ? (
    <div className="flex items-start gap-2">
      <img
        className="rounded-full"
        src={avatarUrl}
        width={32}
        height={32}
        alt=""
      />
      <div className="flex flex-col gap-1 w-full">
        <div className="flex gap-1 justify-start items-baseline">
          <div className="text-[#1B1B1B] text-[13px] font-extrabold leading-[15.2px] dark:text-[#d1d5db]">
            {senderName}
          </div>
          <div className="text-[11px] leading-[13.2px] font-medium text-gray-400">
            {displayDate(createdAt)}
          </div>
        </div>
        <div className="leading-[20px] whitespace-break-spaces text-[14px] font-normal dark:text-[#d1d5db]">
          <StreamingText
            buffer={buffer.map((b) => parsedBuffer(b))}
          ></StreamingText>
        </div>
      </div>
    </div>
  ) : (
    <></>
  );
};

export default React.memo(StreamTextMessage);

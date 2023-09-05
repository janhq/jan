import React, { useEffect } from "react";
import { displayDate } from "@/_utils/datetime";
import { TextCode } from "../TextCode";
import { getMessageCode } from "@/_utils/message";
import { useSubscription } from "@apollo/client";
import {
  SubscribeMessageDocument,
  SubscribeMessageSubscription,
} from "@/graphql";
import { useStore } from "@/_models/RootStore";

type Props = {
  id?: string;
  avatarUrl?: string;
  senderName: string;
  createdAt: number;
  text?: string;
};

const StreamTextMessage: React.FC<Props> = ({
  id,
  senderName,
  createdAt,
  avatarUrl = "",
  text = "",
}) => {
  const [textMessage, setTextMessage] = React.useState(text);
  const [completedTyping, setCompletedTyping] = React.useState(false);
  const tokenIndex = React.useRef(0);
  const { historyStore } = useStore();
  const { data } = useSubscription<SubscribeMessageSubscription>(
    SubscribeMessageDocument,
    {
      variables: {
        id,
      },
    }
  );

  useEffect(() => {
    if (
      data?.messages_by_pk?.content &&
      data.messages_by_pk.content.length > text.length
    ) {
      historyStore.finishActiveConversationWaiting();
    }
  }, [data, text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCompletedTyping(false);

    const stringResponse = data?.messages_by_pk?.content ?? text;

    const intervalId = setInterval(() => {
      setTextMessage(stringResponse.slice(0, tokenIndex.current));

      tokenIndex.current++;

      if (tokenIndex.current > stringResponse.length) {
        clearInterval(intervalId);
        setCompletedTyping(true);
      }
    }, 20);

    return () => clearInterval(intervalId);
  }, [data?.messages_by_pk?.content, text]);

  return textMessage.length > 0 ? (
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
        {textMessage.includes("```") ? (
          getMessageCode(textMessage).map((item, i) => (
            <div className="flex gap-1 flex-col" key={i}>
              <p className="leading-[20px] whitespace-break-spaces text-[14px] font-normal dark:text-[#d1d5db]">
                {item.text}
              </p>
              {item.code.trim().length > 0 && <TextCode text={item.code} />}
            </div>
          ))
        ) : (
          <p className="leading-[20px] whitespace-break-spaces text-[14px] font-normal dark:text-[#d1d5db]">
            {textMessage}
          </p>
        )}
      </div>
    </div>
  ) : (
    <></>
  );
};

export default React.memo(StreamTextMessage);

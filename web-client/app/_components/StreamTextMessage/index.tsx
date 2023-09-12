import React, { useEffect } from "react";
import { displayDate } from "@/_utils/datetime";
import { useStore } from "@/_models/RootStore";
import { StreamingText, useTextBuffer } from "nextjs-openai";
import { MessageSenderType, MessageStatus } from "@/_models/ChatMessage";
import { Role } from "@/_models/History";
import { useMutation } from "@apollo/client";
import {
  UpdateMessageDocument,
  UpdateMessageMutation,
  UpdateMessageMutationVariables,
} from "@/graphql";

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
}) => {
  const [data, setData] = React.useState<any | undefined>();
  const { historyStore } = useStore();
  const conversation = historyStore?.getActiveConversation();
  const [updateMessage] = useMutation<UpdateMessageMutation>(
    UpdateMessageDocument
  );

  React.useEffect(() => {
    if (
      !conversation ||
      conversation.chatMessages.findIndex((e) => e.id === id) !==
        conversation.chatMessages.length - 1
    ) {
      return;
    }
    const messages = conversation?.chatMessages
      .slice(-10)
      .filter((e) => e.id !== id)
      .map((e) => ({
        role:
          e.messageSenderType === MessageSenderType.User
            ? Role.User
            : Role.Assistant,
        content: e.text,
      }));
    setData({
      model: "gpt-3.5-turbo",
      stream: true,
      messages,
      max_tokens: 500,
    });
  }, [conversation]);

  const { buffer, done } = useTextBuffer({
    url: `${process.env.NEXT_PUBLIC_OPEN_AI_ENDPOINT}`,
    data,
    options: {
      cache: "no-cache",
      keepalive: true,
      // mode: "no-cors",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
    },
  });

  const parsedBuffer = (buffer: String) => {
    try {
      console.log(buffer)
      const json = buffer.replace("data: ", "");
      return JSON.parse(json).choices[0].delta.content;
    } catch (e) {
      return "";
    }
  };
  useEffect(() => {
    if (done) {
      // mutate result
      const variables: UpdateMessageMutationVariables = {
        id: id,
        data: {
          content: buffer.join(""),
          status: MessageStatus.Ready,
        },
      };
      updateMessage({
        variables,
      });
    }
  }, [done]);

  useEffect(() => {
    if (buffer.length > 0 && conversation?.isWaitingForModelResponse) {
      historyStore.finishActiveConversationWaiting();
    }
  }, [buffer]);

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
            buffer={buffer.map((e) => parsedBuffer(e))}
            fade={100}
          />
        </div>
      </div>
    </div>
  ) : (
    <></>
  );
};

export default React.memo(StreamTextMessage);

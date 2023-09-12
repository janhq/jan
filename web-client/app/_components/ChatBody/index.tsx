import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/_models/RootStore";
import { observer } from "mobx-react-lite";
import { ChatMessage, MessageStatus, MessageType } from "@/_models/ChatMessage";
import SimpleImageMessage from "../SimpleImageMessage";
import SimpleTextMessage from "../SimpleTextMessage";
import { Instance } from "mobx-state-tree";
import { GenerativeSampleContainer } from "../GenerativeSampleContainer";
import { AiModelType } from "@/_models/Product";
import SampleLlmContainer from "@/_components/SampleLlmContainer";
import SimpleControlNetMessage from "../SimpleControlNetMessage";
import {
  GetConversationMessagesQuery,
  GetConversationMessagesDocument,
} from "@/graphql";
import { useLazyQuery } from "@apollo/client";
import LoadingIndicator from "../LoadingIndicator";
import StreamTextMessage from "../StreamTextMessage";

type Props = {
  onPromptSelected: (prompt: string) => void;
};

export const ChatBody: React.FC<Props> = observer(({ onPromptSelected }) => {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const { historyStore } = useStore();
  const refSmooth = useRef<HTMLDivElement>(null);
  const [heightContent, setHeightContent] = useState(0);

  const refContent = useRef<HTMLDivElement>(null);
  const convo = historyStore.getActiveConversation();
  const [getConversationMessages] = useLazyQuery<GetConversationMessagesQuery>(
    GetConversationMessagesDocument
  );

  useEffect(() => {
    refSmooth.current?.scrollIntoView({ behavior: "instant" });
  }, [heightContent]);

  useLayoutEffect(() => {
    if (refContent.current) {
      setHeightContent(refContent.current?.offsetHeight);
    }
  });

  useLayoutEffect(() => {
    if (!ref.current) return;
    setHeight(ref.current?.offsetHeight);
  }, []);

  const loadFunc = () => {
    historyStore.fetchMoreMessages(getConversationMessages);
  };

  const messages = historyStore.getActiveMessages();

  const shouldShowSampleContainer = messages.length === 0;

  const shouldShowImageSampleContainer =
    shouldShowSampleContainer &&
    convo &&
    convo.product.type === AiModelType.GenerativeArt;

  const model = convo?.product;

  const handleScroll = () => {
    if (!scrollRef.current) return;
    if (
      scrollRef.current?.clientHeight - scrollRef.current?.scrollTop + 1 >=
      scrollRef.current?.scrollHeight
    ) {
      loadFunc();
    }
  };

  useEffect(() => {
    loadFunc();
    scrollRef.current?.addEventListener("scroll", handleScroll);
    return () => {
      scrollRef.current?.removeEventListener("scroll", handleScroll);
    };
  }, [scrollRef.current]);

  return (
    <div className="flex-grow flex flex-col h-fit" ref={ref}>
      {shouldShowSampleContainer && model ? (
        shouldShowImageSampleContainer ? (
          <GenerativeSampleContainer
            model={convo?.product}
            onPromptSelected={onPromptSelected}
          />
        ) : (
          <SampleLlmContainer
            model={convo?.product}
            onPromptSelected={onPromptSelected}
          />
        )
      ) : (
        <div
          className="flex flex-col-reverse scroll"
          style={{
            height: height + "px",
            overflowX: "hidden",
          }}
          ref={scrollRef}
        >
          <div
            className="flex flex-col justify-end gap-8 py-2"
            ref={refContent}
          >
            {messages.map((message, index) => renderItem(index, message))}
            <div ref={refSmooth}>
              {convo?.isWaitingForModelResponse && (
                <div className="w-[50px] h-[50px] px-2 flex flex-row items-start justify-start">
                  <LoadingIndicator />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const renderItem = (
  index: number,
  {
    messageType,
    senderAvatarUrl,
    senderName,
    createdAt,
    imageUrls,
    text,
    status,
  }: Instance<typeof ChatMessage>
) => {
  switch (messageType) {
    case MessageType.ImageWithText:
      return (
        <SimpleControlNetMessage
          key={index}
          avatarUrl={senderAvatarUrl ?? "/icons/app_icon.svg"}
          senderName={senderName}
          createdAt={createdAt}
          imageUrls={imageUrls ?? []}
          text={text ?? ""}
        />
      );
    case MessageType.Image:
      return (
        <SimpleImageMessage
          key={index}
          avatarUrl={senderAvatarUrl ?? "/icons/app_icon.svg"}
          senderName={senderName}
          createdAt={createdAt}
          imageUrls={imageUrls ?? []}
          text={text}
        />
      );
    case MessageType.Text:
      return status === MessageStatus.Ready ? (
        <SimpleTextMessage
          key={index}
          avatarUrl={senderAvatarUrl ?? "/icons/app_icon.svg"}
          senderName={senderName}
          createdAt={createdAt}
          text={text}
        />
      ) : (
        <StreamTextMessage
          key={index}
          avatarUrl={senderAvatarUrl ?? "/icons/app_icon.svg"}
          senderName={senderName}
          createdAt={createdAt}
        />
      );
    default:
      return null;
  }
};

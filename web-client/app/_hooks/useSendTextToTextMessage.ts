import {
  addNewChatMessageToActiveConvoAtom,
  getActiveChatMessagesAtom,
} from "@/_atoms/ChatMessageAtoms";
import { setConvoWaitingStateAtom } from "@/_atoms/ConversationAtoms";
import {
  ChatMessage,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from "@/_models/ChatMessage";
import { Conversation } from "@/_models/Conversation";
import { Role } from "@/_models/User";
import {
  CreateMessageDocument,
  CreateMessageMutation,
  CreateMessageMutationVariables,
} from "@/graphql";
import { useMutation } from "@apollo/client";
import { useAtomValue, useSetAtom } from "jotai";

export default function useSendTextToTextMessage() {
  const [createMessageMutation] = useMutation<CreateMessageMutation>(
    CreateMessageDocument
  );
  const addNewMessage = useSetAtom(addNewChatMessageToActiveConvoAtom);
  const setWaitingState = useSetAtom(setConvoWaitingStateAtom);
  const currentMessages = useAtomValue(getActiveChatMessagesAtom);

  const sendTextToTextMessage = async (
    conversation: Conversation,
    latestUserMessage: ChatMessage
  ) => {
    const messageToSend = [
      latestUserMessage,
      ...currentMessages.slice(0, 4),
    ].reverse();
    const latestMessages = messageToSend.map((e) => ({
      role:
        e.messageSenderType === MessageSenderType.User
          ? Role.User
          : Role.Assistant,
      content: e.text,
    }));

    const variables: CreateMessageMutationVariables = {
      data: {
        conversation_id: conversation.id,
        sender: MessageSenderType.Ai,
        message_sender_type: MessageSenderType.Ai,
        message_type: MessageType.Text,
        sender_avatar_url: conversation.product.avatarUrl,
        sender_name: conversation.product.name,
        prompt_cache: latestMessages,
        status: MessageStatus.Pending,
      },
    };
    const result = await createMessageMutation({
      variables,
    });

    if (!result.data?.insert_messages_one?.id) {
      console.error(
        "Error creating user message",
        JSON.stringify(result.errors)
      );
      setWaitingState(conversation.id, false);
      return;
    }

    const aiResponseMessage: ChatMessage = {
      id: result.data.insert_messages_one.id,
      conversationId: conversation.id,
      messageType: MessageType.Text,
      messageSenderType: MessageSenderType.Ai,
      senderUid: conversation.product.slug,
      senderName: conversation.product.name,
      senderAvatarUrl: conversation.product.avatarUrl ?? "/icons/app_icon.svg",
      text: "",
      status: MessageStatus.Pending,
      createdAt: Date.now(),
    };

    addNewMessage(aiResponseMessage);
  };

  return { sendTextToTextMessage };
}

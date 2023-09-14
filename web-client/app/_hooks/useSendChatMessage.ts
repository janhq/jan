import {
  ChatMessage,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from "@/_models/ChatMessage";
import { ProductType } from "@/_models/Product";
import {
  CreateMessageDocument,
  CreateMessageMutation,
  CreateMessageMutationVariables,
} from "@/graphql";
import { useMutation } from "@apollo/client";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import useSignIn from "./useSignIn";
import useGetCurrentUser from "./useGetCurrentUser";
import {
  activeConversationAtom,
  setConversationLastMessageAtom,
  setConvoWaitingStateAtom,
} from "@/_atoms/ConversationAtoms";
import { currentPromptAtom } from "@/_atoms/PromptAtoms";
import { addNewChatMessageToActiveConvoAtom } from "@/_atoms/ChatMessageAtoms";
import useSendTextToImageMessage from "./useSendTextToImageMessage";
import useSendTextToTextMessage from "./useSendTextToTextMessage";

export default function useSendChatMessage() {
  const [createMessageMutation] = useMutation<CreateMessageMutation>(
    CreateMessageDocument
  );

  const { user } = useGetCurrentUser();
  const { signInWithKeyCloak } = useSignIn();
  const { sendTextToImageMessage } = useSendTextToImageMessage();
  const { sendTextToTextMessage } = useSendTextToTextMessage();

  const [currentPrompt, setCurrentPrompt] = useAtom(currentPromptAtom);
  const addNewMessage = useSetAtom(addNewChatMessageToActiveConvoAtom);
  const activeConversation = useAtomValue(activeConversationAtom);
  const setWaitingState = useSetAtom(setConvoWaitingStateAtom);
  const setLastMessage = useSetAtom(setConversationLastMessageAtom);

  const sendChatMessage = async () => {
    if (!user) {
      signInWithKeyCloak();
      return;
    }
    if (currentPrompt.trim().length === 0) return;

    if (!activeConversation) {
      console.error("No active conversation");
      return;
    }

    setWaitingState(activeConversation.id, true);
    const variables: CreateMessageMutationVariables = {
      data: {
        conversation_id: activeConversation.id,
        content: currentPrompt,
        sender: user.id,
        message_sender_type: MessageSenderType.User,
        message_type: MessageType.Text,
        sender_avatar_url: user.avatarUrl,
        sender_name: user.displayName,
      },
    };
    const result = await createMessageMutation({ variables });

    if (!result.data?.insert_messages_one?.id) {
      // TODO: display error
      console.error(
        "Error creating user message",
        JSON.stringify(result.errors)
      );
      setWaitingState(activeConversation.id, false);
      return;
    }

    const userMesssage: ChatMessage = {
      id: result.data.insert_messages_one.id,
      conversationId: activeConversation.id,
      messageType: MessageType.Text,
      messageSenderType: MessageSenderType.User,
      senderUid: user.id,
      senderName: user.displayName,
      senderAvatarUrl: user.avatarUrl ?? "/icons/app_icon.svg",
      text: currentPrompt,
      createdAt: Date.now(),
      status: MessageStatus.Ready,
    };

    addNewMessage(userMesssage);
    setLastMessage(activeConversation.id, currentPrompt);

    if (activeConversation.product.type === ProductType.LLM) {
      await sendTextToTextMessage(activeConversation, userMesssage);
      setCurrentPrompt("");
    } else if (activeConversation.product.type === ProductType.GenerativeArt) {
      await sendTextToImageMessage(activeConversation);
      setCurrentPrompt("");
    } else {
      console.error(
        "We do not support this model type yet:",
        activeConversation.product.type
      );
    }
  };

  return {
    sendChatMessage,
  };
}

import { addNewChatMessageToActiveConvoAtom } from "@/_atoms/ChatMessageAtoms";
import { setConversationLastImageAtom, setConvoWaitingStateAtom } from "@/_atoms/ConversationAtoms";
import { currentPromptAtom } from "@/_atoms/PromptAtoms";
import {
  ChatMessage,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from "@/_models/ChatMessage";
import { Conversation } from "@/_models/Conversation";
import {
  CreateMessageDocument,
  CreateMessageMutation,
  CreateMessageMutationVariables,
  GenerateImageDocument,
  GenerateImageMutation,
  GenerateImageMutationVariables,
} from "@/graphql";
import { useMutation } from "@apollo/client";
import { useAtomValue, useSetAtom } from "jotai";

export default function useSendTextToImageMessage() {
  const currentPrompt = useAtomValue(currentPromptAtom);
  const setWaitingState = useSetAtom(setConvoWaitingStateAtom);
  const [imageGenerationMutation] = useMutation<GenerateImageMutation>(
    GenerateImageDocument
  );
  const [createMessageMutation] = useMutation<CreateMessageMutation>(
    CreateMessageDocument
  );

  const addNewMessage = useSetAtom(addNewChatMessageToActiveConvoAtom);
  const setLastImage = useSetAtom(setConversationLastImageAtom);

  const sendTextToImageMessage = async (conversation: Conversation) => {
    const variables: GenerateImageMutationVariables = {
      model: conversation.product.slug,
      prompt: currentPrompt,
      neg_prompt: "",
      seed: Math.floor(Math.random() * 429496729),
      steps: 30,
      width: 512,
      height: 512,
    };

    const data = await imageGenerationMutation({
      variables,
    });

    if (!data.data?.imageGeneration?.url) {
      // TODO: display error
      console.error("Error creating user message", JSON.stringify(data.errors));
      setWaitingState(conversation.id, false);
      return;
    }

    const imageUrl: string = data.data.imageGeneration.url;

    const createMessageVariables: CreateMessageMutationVariables = {
      data: {
        conversation_id: conversation.id,
        content: currentPrompt,
        sender: MessageSenderType.Ai,
        message_sender_type: MessageSenderType.Ai,
        message_type: MessageType.Image,
        sender_avatar_url: conversation.product.avatarUrl,
        sender_name: conversation.product.name,
        status: MessageStatus.Ready,
        message_medias: {
          data: [
            {
              media_url: imageUrl,
              mime_type: "image/jpeg",
            },
          ],
        },
      },
    };
    const result = await createMessageMutation({
      variables: createMessageVariables,
    });

    if (!result.data?.insert_messages_one?.id) {
      // TODO: display error
      console.error(
        "Error creating user message",
        JSON.stringify(result.errors)
      );
      setWaitingState(conversation.id, false);
      return;
    }

    const responseImage: ChatMessage = {
      id: result.data.insert_messages_one.id,
      conversationId: conversation.id,
      messageType: MessageType.Image,
      messageSenderType: MessageSenderType.Ai,
      senderUid: conversation.product.slug,
      senderName: conversation.product.name,
      senderAvatarUrl: conversation.product.avatarUrl,
      text: currentPrompt,
      imageUrls: [imageUrl],
      createdAt: Date.now(),
      status: MessageStatus.Ready,
    };

    addNewMessage(responseImage);
    setLastImage(conversation.id, imageUrl);
    setWaitingState(conversation.id, false);
  };

  return {
    sendTextToImageMessage,
  };
}

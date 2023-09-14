import {
  CreateConversationMutation,
  CreateConversationDocument,
  CreateConversationMutationVariables,
} from "@/graphql";
import useGetCurrentUser from "./useGetCurrentUser";
import { useMutation } from "@apollo/client";
import useSignIn from "./useSignIn";
import { Conversation } from "@/_models/Conversation";
import { Product } from "@/_models/Product";
import { MessageSenderType, MessageType } from "@/_models/ChatMessage";
import { useSetAtom } from "jotai";
import { createNewConversationAtom } from "@/_atoms/ConversationAtoms";

const useCreateConversation = () => {
  const addNewConversation = useSetAtom(createNewConversationAtom);
  const { user } = useGetCurrentUser();
  const { signInWithKeyCloak } = useSignIn();
  const [createConversation] = useMutation<CreateConversationMutation>(
    CreateConversationDocument
  );

  const requestCreateConvo = async (product: Product) => {
    if (!user) {
      signInWithKeyCloak();
      return;
    }

    const variables: CreateConversationMutationVariables = {
      data: {
        product_id: product.id,
        user_id: user.id,
        last_image_url: "",
        last_text_message: product.greeting,
        conversation_messages: {
          data: [
            {
              content: product.greeting || "Hello there 👋",
              sender: MessageSenderType.Ai,
              sender_name: product.name,
              sender_avatar_url: product.avatarUrl,
              message_type: MessageType.Text,
              message_sender_type: MessageSenderType.Ai,
            },
          ],
        },
      },
    };
    const result = await createConversation({
      variables,
    });
    const newConvo = result.data?.insert_conversations_one;

    if (newConvo) {
      const mappedConvo: Conversation = {
        id: newConvo.id,
        product: product,
        lastTextMessage: newConvo.last_text_message ?? "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      addNewConversation(mappedConvo);
    }
  };

  return {
    requestCreateConvo,
  };
};

export default useCreateConversation;

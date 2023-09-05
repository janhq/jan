import {
  ProductDetailFragment,
  CreateConversationMutation,
  CreateConversationDocument,
  CreateConversationMutationVariables,
} from "@/graphql";
import { useStore } from "../_models/RootStore";
import useGetCurrentUser from "./useGetCurrentUser";
import { useMutation } from "@apollo/client";
import { MessageSenderType, MessageType } from "@/_models/ChatMessage";
import useSignIn from "./useSignIn";

const useCreateConversation = () => {
  const { historyStore } = useStore();
  const { user } = useGetCurrentUser();
  const { signInWithKeyCloak } = useSignIn();
  const [createConversation] = useMutation<CreateConversationMutation>(
    CreateConversationDocument
  );

  const requestCreateConvo = async (
    product: ProductDetailFragment,
    forceCreate: boolean = false
  ) => {
    if (!user) {
      signInWithKeyCloak();
      return;
    }

    // search if any fresh convo with particular product id
    const convo = historyStore.conversations.find(
      (convo) =>
        convo.product.id === product.slug && convo.chatMessages.length <= 1
    );

    if (convo && !forceCreate) {
      historyStore.setActiveConversationId(convo.id);
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
              sender_avatar_url: product.image_url ?? "",
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

    if (result.data?.insert_conversations_one) {
      historyStore.createConversation(
        result.data.insert_conversations_one,
        product,
        user.id,
        user.displayName
      );
    }
    // if not found, create new convo and set it as current
  };

  return {
    requestCreateConvo,
  };
};

export default useCreateConversation;

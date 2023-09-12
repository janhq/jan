import {
  CreateConversationMutation,
  CreateConversationDocument,
  CreateConversationMutationVariables,
} from "@/graphql";
import useGetCurrentUser from "./useGetCurrentUser";
import { useMutation } from "@apollo/client";
import useSignIn from "./useSignIn";
import { useAtom, useSetAtom } from "jotai";
import {
  addNewConversationStateAtom,
  setActiveConvoIdAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";
import { Conversation } from "@/_models/Conversation";
import { Product } from "@/_models/Product";
import { MessageSenderType, MessageType } from "@/_models/ChatMessage";

const useCreateConversation = () => {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);
  const addNewConvoState = useSetAtom(addNewConversationStateAtom);
  const { user } = useGetCurrentUser();
  const { signInWithKeyCloak } = useSignIn();
  const [createConversation] = useMutation<CreateConversationMutation>(
    CreateConversationDocument
  );

  const requestCreateConvo = async (
    product: Product,
    forceCreate: boolean = false
  ) => {
    if (!user) {
      signInWithKeyCloak();
      return;
    }

    // search if any fresh convo with particular product id
    const convo = userConversations.find(
      (convo) => convo.product.slug === product.slug
    );

    if (convo && !forceCreate) {
      setActiveConvoId(convo.id);
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
        user: {
          id: user.id,
          displayName: user.displayName,
        },
        lastTextMessage: newConvo.last_text_message ?? "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addNewConvoState(newConvo.id, {
        hasMore: true,
        waitingForResponse: false,
      });
      setUserConversations([...userConversations, mappedConvo]);
      setActiveConvoId(newConvo.id);
    }
    // if not found, create new convo and set it as current
  };

  return {
    requestCreateConvo,
  };
};

export default useCreateConversation;

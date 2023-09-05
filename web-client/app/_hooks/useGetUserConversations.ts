import { Instance } from "mobx-state-tree";
import { useStore } from "../_models/RootStore";
import { AiModelType } from "../_models/Product";
import { Conversation } from "../_models/Conversation";
import { User } from "../_models/User";
import { GetConversationsQuery, GetConversationsDocument } from "@/graphql";
import { useLazyQuery } from "@apollo/client";

const useGetUserConversations = () => {
  const { historyStore } = useStore();
  const [getConvos] = useLazyQuery<GetConversationsQuery>(
    GetConversationsDocument
  );

  const getUserConversations = async (user: Instance<typeof User>) => {
    const results = await getConvos();
    if (!results || !results.data || results.data.conversations.length === 0) {
      return;
    }

    const convos = results.data.conversations;

    const finalConvo: Instance<typeof Conversation>[] = [];
    // mapping
    convos.forEach((convo) => {
      const conversation = Conversation.create({
        id: convo.id!!,
        product: {
          id: convo.conversation_product?.slug || convo.conversation_product?.id,
          name: convo.conversation_product?.name ?? "",
          type:
            convo.conversation_product?.inputs.slug === "llm"
              ? AiModelType.LLM
              : convo.conversation_product?.inputs.slug === "sd"
              ? AiModelType.GenerativeArt
              : AiModelType.ControlNet,
          avatarUrl: convo.conversation_product?.image_url,
          description: convo.conversation_product?.description,
          modelDescription: convo.conversation_product?.description,
          modelUrl: convo.conversation_product?.source_url,
          modelVersion: convo.conversation_product?.version,
        },
        chatMessages: [],
        user: user,
        createdAt: new Date(convo.created_at).getTime(),
        updatedAt: new Date(convo.updated_at).getTime(),
        lastImageUrl: convo.last_image_url ?? "",
        lastTextMessage: convo.last_text_message ?? "",
      });

      finalConvo.push(conversation);
    });

    historyStore.setConversations(finalConvo);
  };

  return {
    getUserConversations,
  };
};

export default useGetUserConversations;

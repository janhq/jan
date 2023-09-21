import {
  SubscribeMessageSubscription,
  SubscribeMessageDocument,
} from "@/graphql";
import { useSubscription } from "@apollo/client";

const useChatMessageSubscription = (messageId: string) => {
  const { data, loading, error } =
    useSubscription<SubscribeMessageSubscription>(SubscribeMessageDocument, {
      variables: { id: messageId },
    });

  return { data, loading, error };
};

export default useChatMessageSubscription;

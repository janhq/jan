import {
  currentPromptAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  showingAdvancedPromptAtom,
  showingProductDetailAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";
import {
  DeleteConversationDocument,
  DeleteConversationMutation,
} from "@/graphql";
import { useMutation } from "@apollo/client";
import { useAtom, useAtomValue, useSetAtom } from "jotai";

export default function useDeleteConversation() {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setCurrentPrompt = useSetAtom(currentPromptAtom);
  const setShowingProductDetail = useSetAtom(showingProductDetailAtom);
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom);
  const activeConvoId = useAtomValue(getActiveConvoIdAtom);
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);

  const [deleteConversation] = useMutation<DeleteConversationMutation>(
    DeleteConversationDocument
  );

  const deleteConvo = async () => {
    if (activeConvoId) {
      try {
        await deleteConversation({ variables: { id: activeConvoId } });
        setUserConversations(
          userConversations.filter((c) => c.id !== activeConvoId)
        );
        setActiveConvoId(undefined);
        setCurrentPrompt("");
        setShowingProductDetail(false);
        setShowingAdvancedPrompt(false);
      } catch (err) {
        console.error(err);
      }
    }
  };

  return {
    deleteConvo,
  };
}

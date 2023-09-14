import {
  activeConversationIdAtom,
  removeConversationAtom,
} from "@/_atoms/ConversationAtoms";
import {
  showingProductDetailAtom,
  showingAdvancedPromptAtom,
} from "@/_atoms/ModalAtoms";
import { currentPromptAtom } from "@/_atoms/PromptAtoms";
import {
  DeleteConversationDocument,
  DeleteConversationMutation,
} from "@/graphql";
import { useMutation } from "@apollo/client";
import { useAtom, useSetAtom } from "jotai";

export default function useDeleteConversation() {
  const removeConversation = useSetAtom(removeConversationAtom);
  const setCurrentPrompt = useSetAtom(currentPromptAtom);
  const setShowingProductDetail = useSetAtom(showingProductDetailAtom);
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom);
  const [activeConvoId, setActiveConvoId] = useAtom(activeConversationIdAtom);

  const [deleteConversation] = useMutation<DeleteConversationMutation>(
    DeleteConversationDocument
  );

  const deleteConvo = async () => {
    if (activeConvoId) {
      try {
        await deleteConversation({ variables: { id: activeConvoId } });
        removeConversation(activeConvoId);
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

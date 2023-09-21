import {
  currentPromptAtom,
  getActiveConvoIdAtom,
  setActiveConvoIdAtom,
  showingAdvancedPromptAtom,
  showingProductDetailAtom,
  userConversationsAtom,
} from "@/_helpers/JotaiWrapper";
import { execute } from "@/_services/pluginService";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { DataService } from "../../shared/coreService";

export default function useDeleteConversation() {
  const [userConversations, setUserConversations] = useAtom(
    userConversationsAtom
  );
  const setCurrentPrompt = useSetAtom(currentPromptAtom);
  const setShowingProductDetail = useSetAtom(showingProductDetailAtom);
  const setShowingAdvancedPrompt = useSetAtom(showingAdvancedPromptAtom);
  const activeConvoId = useAtomValue(getActiveConvoIdAtom);
  const setActiveConvoId = useSetAtom(setActiveConvoIdAtom);

  const deleteConvo = async () => {
    if (activeConvoId) {
      try {
        await execute(DataService.DELETE_CONVERSATION, activeConvoId);
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

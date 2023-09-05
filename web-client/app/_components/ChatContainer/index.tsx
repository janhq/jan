"use client";
import { useState, useEffect } from "react";
import { ChatBody } from "../ChatBody";
import { InputToolbar } from "../InputToolbar";
import { UserToolbar } from "../UserToolbar";
import ModelMenu from "../ModelMenu";
import { useStore } from "@/_models/RootStore";
import { observer } from "mobx-react-lite";
import ConfirmDeleteConversationModal from "../ConfirmDeleteConversationModal";
import { ModelDetailSideBar } from "../ModelDetailSideBar";
import NewChatBlankState from "../NewChatBlankState";
import useGetCurrentUser from "@/_hooks/useGetCurrentUser";
import {
  DeleteConversationMutation,
  DeleteConversationDocument,
} from "@/graphql";
import { useMutation } from "@apollo/client";

const ChatContainer: React.FC = observer(() => {
  const [prefillPrompt, setPrefillPrompt] = useState("");
  const { historyStore } = useStore();
  const { user } = useGetCurrentUser();
  const showBodyChat = historyStore.activeConversationId != null;
  const conversation = historyStore.getActiveConversation();
  const [deleteConversation] = useMutation<DeleteConversationMutation>(
    DeleteConversationDocument
  );

  useEffect(() => {
    if (!user) {
      historyStore.clearAllConversations();
    }
  }, [user]);

  const [open, setOpen] = useState(false);

  const onConfirmDelete = () => {
    setPrefillPrompt("");
    historyStore.closeModelDetail();
    if (conversation?.id) {
      deleteConversation({ variables: { id: conversation.id } }).then(() =>
        historyStore.deleteConversationById(conversation.id)
      );
    }
    setOpen(false);
  };

  const onSuggestPromptClick = (prompt: string) => {
    if (prompt !== prefillPrompt) {
      setPrefillPrompt(prompt);
    }
  };

  return (
    <div className="flex flex-1 h-full overflow-y-hidden">
      <ConfirmDeleteConversationModal
        open={open}
        setOpen={setOpen}
        onConfirmDelete={onConfirmDelete}
      />
      {showBodyChat ? (
        <div className="flex-1 flex flex-col w-full">
          <div className="flex w-full overflow-hidden flex-shrink-0 px-3 py-1 border-b dark:bg-gray-950 border-gray-200 bg-white shadow-sm sm:px-3 lg:px-3">
            {/* Separator */}
            <div
              className="h-full w-px bg-gray-200 lg:hidden"
              aria-hidden="true"
            />

            <div className="flex justify-between self-stretch flex-1">
              <UserToolbar />
              <ModelMenu
                onDeleteClick={() => setOpen(true)}
                onCreateConvClick={() => {}}
              />
            </div>
          </div>
          <div className="flex flex-col h-full px-1 sm:px-2 lg:px-3 overflow-hidden">
            <ChatBody onPromptSelected={onSuggestPromptClick} />
            <InputToolbar prefillPrompt={prefillPrompt} />
          </div>
        </div>
      ) : (
        <NewChatBlankState />
      )}
      <ModelDetailSideBar onPromptClick={onSuggestPromptClick} />
    </div>
  );
});

export default ChatContainer;

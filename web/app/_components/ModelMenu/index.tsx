"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import useCreateConversation from "@/_hooks/useCreateConversation";
import { showConfirmDeleteConversationModalAtom } from "@/_helpers/atoms/Modal.atom";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

const ModelMenu: React.FC = () => {
  const currentProduct = useAtomValue(currentProductAtom);
  const { requestCreateConvo } = useCreateConversation();
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  );

  const onCreateConvoClick = () => {
    if (currentProduct) {
      requestCreateConvo(currentProduct);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button onClick={() => onCreateConvoClick()}>
        <PlusIcon width={24} height={24} color="#9CA3AF" />
      </button>
      <button onClick={() => setShowConfirmDeleteConversationModal(true)}>
        <TrashIcon width={24} height={24} color="#9CA3AF" />
      </button>
    </div>
  );
};

export default ModelMenu;

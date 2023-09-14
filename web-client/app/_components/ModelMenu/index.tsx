"use client";

import Image from "next/image";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  currentProductAtom,
  showConfirmDeleteConversationModalAtom,
  showingProductDetailAtom,
} from "@/_helpers/JotaiWrapper";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import useCreateConversation from "@/_hooks/useCreateConversation";

const ModelMenu: React.FC = () => {
  const currentProduct = useAtomValue(currentProductAtom);
  const [active, setActive] = useAtom(showingProductDetailAtom);
  const { requestCreateConvo } = useCreateConversation();
  const setShowConfirmDeleteConversationModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  );

  const onCreateConvoClick = () => {
    if (!currentProduct) return;
    requestCreateConvo(currentProduct, true);
  };

  return (
    <div className="flex items-center gap-3">
      <button onClick={() => onCreateConvoClick()}>
        <PlusIcon width={24} height={24} color="#9CA3AF" />
      </button>
      <button onClick={() => setShowConfirmDeleteConversationModal(true)}>
        <TrashIcon width={24} height={24} color="#9CA3AF" />
      </button>
      <button onClick={() => setActive(!active)}>
        <Image
          src={active ? "/icons/ic_sidebar_fill.svg" : "/icons/ic_sidebar.svg"}
          width={24}
          height={24}
          alt=""
        />
      </button>
    </div>
  );
};

export default ModelMenu;

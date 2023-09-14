"use client";

import Image from "next/image";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import useCreateConversation from "@/_hooks/useCreateConversation";
import {
  showConfirmDeleteConversationModalAtom,
  showingProductDetailAtom,
} from "@/_atoms/ModalAtoms";
import { activeConversationAtom } from "@/_atoms/ConversationAtoms";

const ModelMenu: React.FC = () => {
  const activeConvo = useAtomValue(activeConversationAtom);
  const [active, setActive] = useAtom(showingProductDetailAtom);
  const { requestCreateConvo } = useCreateConversation();
  const showConfirmDeleteModal = useSetAtom(
    showConfirmDeleteConversationModalAtom
  );

  const onCreateConvoClick = () => {
    const product = activeConvo?.product;
    if (!product) return;
    requestCreateConvo(product);
  };

  return (
    <div className="flex items-center gap-3">
      <button onClick={() => onCreateConvoClick()}>
        <PlusIcon width={24} height={24} color="#9CA3AF" />
      </button>
      <button onClick={() => showConfirmDeleteModal(true)}>
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

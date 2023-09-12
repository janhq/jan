"use client";

import ConfirmDeleteConversationModal from "@/_components/ConfirmDeleteConversationModal";
import ConfirmSignOutModal from "@/_components/ConfirmSignOutModal";
import MobileMenuPane from "@/_components/MobileMenuPane";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export const ModalWrapper: React.FC<Props> = ({ children }) => (
  <>
    <MobileMenuPane />
    <ConfirmDeleteConversationModal />
    <ConfirmSignOutModal />
    {children}
  </>
);

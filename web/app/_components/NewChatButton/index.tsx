"use client";

import React from "react";
import SecondaryButton from "../SecondaryButton";
import { useAtomValue, useSetAtom } from "jotai";
import {
  MainViewState,
  setMainViewStateAtom,
} from "@/_helpers/atoms/MainView.atom";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";
import useCreateConversation from "@/_hooks/useCreateConversation";
import useInitModel from "@/_hooks/useInitModel";
import { Product } from "@/_models/Product";
import { PlusIcon } from "@heroicons/react/24/outline";

const NewChatButton: React.FC = () => {
  const activeModel = useAtomValue(currentProductAtom);
  const setMainView = useSetAtom(setMainViewStateAtom);
  const { requestCreateConvo } = useCreateConversation();
  const { initModel } = useInitModel();

  const onClick = () => {
    if (!activeModel) {
      setMainView(MainViewState.ConversationEmptyModel);
    } else {
      createConversationAndInitModel(activeModel);
    }
  };

  const createConversationAndInitModel = async (model: Product) => {
    await requestCreateConvo(model);
    await initModel(model);
  };

  return (
    <SecondaryButton
      title={"New Chat"}
      onClick={onClick}
      className="my-5 mx-3"
      icon={<PlusIcon width={16} height={16} />}
    />
  );
};

export default React.memo(NewChatButton);

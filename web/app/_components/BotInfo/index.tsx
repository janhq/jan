import { activeBotAtom } from "@/_helpers/atoms/Bot.atom";
import {
  MainViewState,
  setMainViewStateAtom,
} from "@/_helpers/atoms/MainView.atom";
import useCreateConversation from "@/_hooks/useCreateConversation";
import useDeleteBot from "@/_hooks/useDeleteBot";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";

const BotInfo: React.FC = () => {
  const { deleteBot } = useDeleteBot();
  const { createConvoByBot } = useCreateConversation();
  const setMainView = useSetAtom(setMainViewStateAtom);
  const botInfo = useAtomValue(activeBotAtom);
  if (!botInfo) return null;

  const onNewChatClicked = () => {
    if (!botInfo) {
      alert("No bot selected");
      return;
    }

    createConvoByBot(botInfo);
  };

  const onDeleteBotClick = async () => {
    // TODO: display confirmation diaglog
    const result = await deleteBot(botInfo._id);
    if (result === "success") {
      setMainView(MainViewState.Welcome);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div>Bot Info</div>

      {/* Body */}
      <div className="flex flex-col">
        <label>{botInfo.name}</label>
        <button onClick={onNewChatClicked}>New chat</button>
        <span>{botInfo.description}</span>
      </div>

      <div role="button" onClick={onDeleteBotClick}>
        <span>Delete bot</span>
      </div>
    </div>
  );
};

export default BotInfo;

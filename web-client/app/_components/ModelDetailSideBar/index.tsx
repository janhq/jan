import { FC, useRef } from "react";
import OverviewPane from "../OverviewPane";
import { observer } from "mobx-react-lite";
import { useStore } from "@/_models/RootStore";
import { Draggable } from "../Draggable";

type Props = {
  onPromptClick?: (prompt: string) => void;
};

export const ModelDetailSideBar: FC<Props> = observer(({ onPromptClick }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { historyStore } = useStore();
  const conversation = useStore().historyStore.getActiveConversation();

  return (
    <div
      style={historyStore.showModelDetail ? { width: "473px" } : {}}
      ref={ref}
      className={`${
        historyStore.showModelDetail ? "w-[473px]" : "hidden"
      } flex flex-col gap-3 h-full p-3 relative pb-3 border-l-[1px] border-[#E5E7EB]`}
    >
      <Draggable targetRef={ref} />
      <div className="flex-col h-full gap-3 flex flex-1">
        <OverviewPane
          slug={conversation?.product.id ?? ""}
          onPromptClick={onPromptClick}
          description={conversation?.product.description}
          technicalURL={conversation?.product.modelUrl}
          technicalVersion={conversation?.product.modelVersion}
        />
      </div>
    </div>
  );
});

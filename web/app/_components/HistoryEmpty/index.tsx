import useCreateConversation from "@/_hooks/useCreateConversation";
import { executeSerial } from "@/_services/pluginService";
import Image from "next/image";
import React from "react";
import { DataService } from "../../../shared/coreService";

const HistoryEmpty: React.FC = () => {
  const { requestCreateConvo } = useCreateConversation();
  const startChat = async () => {
    const downloadedModels = await executeSerial(
      DataService.GET_FINISHED_DOWNLOAD_MODELS
    );
    if (!downloadedModels || downloadedModels?.length === 0) {
      alert(
        "Seems like there is no model downloaded yet. Please download a model first."
      );
    } else {
      requestCreateConvo(downloadedModels[0]);
    }
  };
  return (
    <div className="mt-5 flex flex-col w-full h-full items-center justify-center gap-4">
      <Image
        src={"icons/chats-circle-light.svg"}
        width={50}
        height={50}
        alt=""
      />
      <p className="text-sm leading-5 text-center text-[#9CA3AF]">
        Its empty here
      </p>
      <button
        onClick={startChat}
        className="bg-[#1F2A37] py-[10px] px-5 gap-2 rounded-[8px] text-[14px] font-medium leading-[21px] text-white"
      >
        Let&apos;s chat
      </button>
    </div>
  );
};

export default React.memo(HistoryEmpty);

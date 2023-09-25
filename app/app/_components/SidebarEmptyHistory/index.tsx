import Image from "next/image";
import { SidebarButton } from "../SidebarButton";
import { executeSerial } from "../../../electron/core/plugin-manager/execution/extension-manager";
import { ModelManagementService } from "../../../shared/coreService";
import useCreateConversation from "@/_hooks/useCreateConversation";

const SidebarEmptyHistory: React.FC = () => {
  const { requestCreateConvo } = useCreateConversation();
  const startChat = async () => {
    const downloadedModels = await executeSerial(
      ModelManagementService.GET_DOWNLOADED_MODELS
    );
    if (!downloadedModels || downloadedModels.length === 0) {
      alert(
        "Seems like there is no model downloaded yet. Please download a model first."
      );
    } else {
      requestCreateConvo(1);
    }
  };
  return (
    <div className="flex flex-col items-center py-10 gap-3">
      <Image
        src={"icons/chat-bubble-oval-left.svg"}
        width={32}
        height={32}
        alt=""
      />
      <div className="flex flex-col items-center gap-6">
        <div>
          <div className="text-center text-gray-900 text-sm">
            No Chat History
          </div>
          <div className="text-center text-gray-500 text-sm">
            Get started by creating a new chat.
          </div>
        </div>
        <SidebarButton
          callback={startChat}
          className="flex items-center border bg-blue-600 rounded-lg py-[9px] pl-[15px] pr-[17px] gap-2 text-white font-medium text-sm"
          height={14}
          icon="icons/Icon_plus.svg"
          title="New chat"
          width={14}
        />
      </div>
    </div>
  );
};

export default SidebarEmptyHistory;

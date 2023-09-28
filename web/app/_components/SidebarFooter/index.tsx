import React from "react";
import { SidebarButton } from "../SidebarButton";

const SidebarFooter: React.FC = () => (
  <div className="flex justify-between items-center gap-2">
    <SidebarButton
      className="flex items-center border border-gray-200 rounded-lg p-2 gap-3 flex-1 justify-center text-gray-900 font-medium text-sm"
      height={24}
      icon="icons/discord.svg"
      title="Discord"
      width={24}
      callback={() => {
        window.electronAPI?.openExternalUrl("https://discord.gg/AsJ8krTT3N");
      }}
    />
    <SidebarButton
      className="flex items-center border border-gray-200 rounded-lg p-2 gap-3 flex-1 justify-center text-gray-900 font-medium text-sm"
      height={24}
      icon="icons/unicorn_twitter.svg"
      title="Twitter"
      width={24}
      callback={() => {
        window.electronAPI?.openExternalUrl("https://twitter.com/jan_dotai");
      }}
    />
  </div>
);

export default React.memo(SidebarFooter);

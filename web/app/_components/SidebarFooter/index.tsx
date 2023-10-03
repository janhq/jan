import React from "react";
import SecondaryButton from "../SecondaryButton";

const SidebarFooter: React.FC = () => (
  <div className="flex justify-between items-center gap-2">
    <SecondaryButton
      title={"Discord"}
      onClick={() =>
        window.electronAPI?.openExternalUrl("https://discord.gg/AsJ8krTT3N")
      }
      className="flex-1"
    />
    <SecondaryButton
      title={"Discord"}
      onClick={() =>
        window.electronAPI?.openExternalUrl("https://twitter.com/jan_dotai")
      }
      className="flex-1"
    />
  </div>
);

export default React.memo(SidebarFooter);

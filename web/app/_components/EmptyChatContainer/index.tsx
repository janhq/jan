import React from "react";
import SelectModels from "../ModelSelector";
import InputToolbar from "../InputToolbar";

const EmptyChatContainer: React.FC = () => (
  <div className="flex flex-col flex-1">
    <div className="flex flex-1 items-center justify-center">
      <SelectModels />
    </div>
    <InputToolbar />
  </div>
);

export default EmptyChatContainer;

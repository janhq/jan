import React, { Fragment, useState } from "react";
import ToggleSwitch from "../ToggleSwitch";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import CutomBotTemperature from "../CustomBotTemperature";

type Props = {
  control?: any;
};

const CreateBotInAdvance: React.FC<Props> = ({ control }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleShowAdvanced = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setShowAdvanced(!showAdvanced);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start">
        <button
          className="flex items-center justify-center text-gray-900 font-bold"
          onClick={handleShowAdvanced}
        >
          Advanced
          {showAdvanced ? (
            <ChevronDownIcon width={16} className="ml-2" />
          ) : (
            <ChevronUpIcon width={16} className="ml-2" />
          )}
        </button>
      </div>
      {showAdvanced && (
        <Fragment>
          <ToggleSwitch
            id="suggestReplies"
            title="Suggest replies"
            control={control}
          />
          <ToggleSwitch
            id="renderMarkdownContent"
            title="Render markdown content"
            control={control}
          />
          <CutomBotTemperature control={control} />
        </Fragment>
      )}
    </div>
  );
};

export default CreateBotInAdvance;

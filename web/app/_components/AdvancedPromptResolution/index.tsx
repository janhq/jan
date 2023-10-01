import React, { useState } from "react";
import { DropdownsList } from "../DropdownList";
import TogglableHeader from "../TogglableHeader";

const AdvancedPromptResolution = () => {
  const [expand, setExpand] = useState(true);
  const data = ["512", "524", "536"];
  const ratioData = ["1:1", "2:2", "3:3"];

  return (
    <>
      <TogglableHeader
        icon={"icons/unicorn_layers-alt.svg"}
        title={"Resolution"}
        expand={expand}
        onTitleClick={() => setExpand(!expand)}
      />
      <div className={`${expand ? "flex" : "hidden"} flex-col gap-[5px]`}>
        <div className="flex gap-3 py-3">
          <DropdownsList data={data} title="Width" />
          <DropdownsList data={data} title="Height" />
        </div>
        <DropdownsList title="Select ratio" data={ratioData} />
      </div>
    </>
  );
};

export default AdvancedPromptResolution;

import React, { useState } from "react";
import TogglableHeader from "../TogglableHeader";

const AdvancedPromptGenerationParams = () => {
  const [expand, setExpand] = useState(true);
  return (
    <>
      <TogglableHeader
        icon={"/icons/unicorn_layers-alt.svg"}
        title={"Generation Parameters"}
        expand={expand}
        onTitleClick={() => setExpand(!expand)}
      />
    </>
  );
};

export default AdvancedPromptGenerationParams;

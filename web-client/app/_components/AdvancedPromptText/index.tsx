import React, { useState } from "react";
import TogglableHeader from "../TogglableHeader";
import { AdvancedTextArea } from "../AdvancedTextArea";
import { FieldValues, UseFormRegister } from "react-hook-form";

type Props = {
  register: UseFormRegister<FieldValues>;
};

const AdvancedPromptText: React.FC<Props> = ({ register }) => {
  const [expand, setExpand] = useState(true);

  return (
    <>
      <TogglableHeader
        icon={"icons/messicon.svg"}
        title={"Prompt"}
        expand={expand}
        onTitleClick={() => setExpand(!expand)}
      />
      <div className={`${expand ? "flex" : "hidden"} flex-col gap-[5px]`}>
        <AdvancedTextArea
          formId="prompt"
          height={80}
          placeholder="Prompt"
          title="Prompt"
          register={register}
        />
        <AdvancedTextArea
          formId="negativePrompt"
          height={80}
          placeholder="Describe what you don't want in your image"
          title="Negative Prompt"
          register={register}
        />
      </div>
    </>
  );
};

export default AdvancedPromptText;

import React, { useState } from "react";
import { DropdownsList } from "../DropdownList";
import TogglableHeader from "../TogglableHeader";
import { UploadFileImage } from "../UploadFileImage";
import { FieldValues, UseFormRegister } from "react-hook-form";

type Props = {
  register: UseFormRegister<FieldValues>;
};

const AdvancedPromptImageUpload: React.FC<Props> = ({ register }) => {
  const [expand, setExpand] = useState(true);
  const data = ["test1", "test2", "test3", "test4"];

  return (
    <>
      <TogglableHeader
        icon={"icons/ic_image.svg"}
        title={"Image"}
        expand={expand}
        onTitleClick={() => setExpand(!expand)}
      />
      <div className={`${expand ? "flex" : "hidden"} flex-col gap-[5px]`}>
        <UploadFileImage register={register} />
        <DropdownsList title="Control image with ControlNet:" data={data} />
      </div>
    </>
  );
};

export default AdvancedPromptImageUpload;

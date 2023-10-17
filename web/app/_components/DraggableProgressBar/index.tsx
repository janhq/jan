import { formatTwoDigits } from "@/_utils/converter";
import React from "react";
import { Controller, useController } from "react-hook-form";

type Props = {
  id: string;
  control: any;
};

const DraggableProgressBar: React.FC<Props> = ({ id, control }) => {
  const { field } = useController({
    name: id,
    control: control,
  });

  return (
    <div className="flex items-center gap-2 mt-2">
      <input
        {...field}
        className="flex-1"
        type="range"
        id="volume"
        name="volume"
        min="0"
        max="1"
        step="0.01"
      />
      <Controller
        name={id}
        control={control}
        render={({ field: { value } }) => (
          <span className="border border-[#737d7d] rounded-md py-1 px-2 text-gray-900">
            {formatTwoDigits(value)}
          </span>
        )}
      />
    </div>
  );
};

export default DraggableProgressBar;

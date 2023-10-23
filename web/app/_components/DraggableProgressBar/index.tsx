import { formatTwoDigits } from "@/_utils/converter";
import React from "react";
import { Controller, useController } from "react-hook-form";

type Props = {
  id: string;
  control: any;
  min: number;
  max: number;
  step: number;
};

const DraggableProgressBar: React.FC<Props> = ({ id, control, min, max, step }) => {
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
        min={min}
        max={max}
        step={step}
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

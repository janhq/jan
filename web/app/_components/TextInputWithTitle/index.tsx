import React from "react";
import { useController } from "react-hook-form";

type Props = {
  id: string;
  title: string;
  description: string;
  placeholder?: string;
  control?: any;
  required?: boolean;
};

const TextInputWithTitle: React.FC<Props> = ({
  id,
  title,
  description,
  placeholder,
  control,
  required = false,
}) => {
  const { field } = useController({
    name: id,
    control: control,
    rules: { required: required },
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="text-gray-900 font-bold">{title}</div>
      <div className="text-sm pb-2 text-[#737d7d]">{description}</div>
      <input
        className="block w-full rounded-md border-0 py-1.5 bg-transparent shadow-sm ring-1 ring-inset text-gray-900 ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        placeholder={placeholder}
        {...field}
      />
    </div>
  );
};

export default TextInputWithTitle;

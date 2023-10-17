import React from "react";
import { useController } from "react-hook-form";

type Props = {
  id: string;
  title: string;
  placeholder: string;
  description?: string;
  control?: any;
  required?: boolean;
};

const TextAreaWithTitle: React.FC<Props> = ({
  id,
  title,
  placeholder,
  description,
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
      <label
        htmlFor="comment"
        className="block text-base text-gray-900 font-bold"
      >
        {title}
      </label>
      {description && (
        <p className="text-sm text-gray-400 font-normal">{description}</p>
      )}
      <textarea
        rows={4}
        className="block w-full resize-none rounded-md border-0 py-1.5 bg-transparent shadow-sm ring-1 ring-inset text-gray-900 ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
        placeholder={placeholder}
        {...field}
      />
    </div>
  );
};

export default TextAreaWithTitle;

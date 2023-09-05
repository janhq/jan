import { FieldValues, UseFormRegister } from "react-hook-form";

type Props = {
  formId?: string;
  height: number;
  title: string;
  placeholder: string;
  register: UseFormRegister<FieldValues>;
};

export const AdvancedTextArea: React.FC<Props> = ({
  formId = "",
  height,
  placeholder,
  title,
  register,
}) => (
  <div className="w-full flex flex-col pt-3 gap-1">
    <label className="text-sm leading-5 text-gray-800">{title}</label>
    <textarea
      style={{ height: `${height}px` }}
      className="rounded-lg py-[13px] px-5 border outline-none resize-none border-gray-300 bg-gray-50 placeholder:gray-400 text-sm font-normal"
      placeholder={placeholder}
      {...register(formId, { required: formId === "prompt" ? true : false })}
    />
  </div>
);

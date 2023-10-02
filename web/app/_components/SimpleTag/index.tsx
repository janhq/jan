import React from "react";

export enum TagType {
  Roleplay = "Roleplay",
  Llama = "Llama",
  Story = "Story",
  Casual = "Casual",
  Professional = "Professional",
  CodeLlama = "CodeLlama",
  Coding = "Coding",
}

const tagStyleMapper: Record<TagType, string> = {
  [TagType.Roleplay]: "bg-red-100 text-red-800",
  [TagType.Llama]: "bg-green-100 text-green-800",
  [TagType.Story]: "bg-blue-100 text-blue-800",
  [TagType.Casual]: "bg-yellow-100 text-yellow-800",
  [TagType.Professional]: "text-indigo-800 bg-indigo-100",
  [TagType.CodeLlama]: "bg-pink-100 text-pink-800",
  [TagType.Coding]: "text-purple-800 bg-purple-100",
};

type Props = {
  title: string;
  type: TagType;
  onClick?: () => void;
};

export const SimpleTag: React.FC<Props> = ({ onClick, title, type }) => {
  return (
    <button
      onClick={onClick}
      className={`px-[10px] py-0.5 rounded text-xs font-medium ${tagStyleMapper[type]}`}
    >
      {title} x
    </button>
  );
};

export default SimpleTag;

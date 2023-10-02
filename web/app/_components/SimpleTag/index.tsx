import React from "react";

export enum TagType {
  Roleplay = "Roleplay",
  Llama = "Llama",
  Story = "Story",
  Casual = "Casual",
  Professional = "Professional",
  CodeLlama = "CodeLlama",
  Coding = "Coding",

  // Positive
  Recommended = "Recommended",
  Compatible = "Compatible",

  // Neutral
  SlowOnDevice = "This model will be slow on your device",

  // Negative
  InsufficientRam = "Insufficient RAM",
  Incompatible = "Incompatible with your device",
  TooLarge = "This model is too large for your device",

  // Performance
  Medium = "Medium",
  BalancedQuality = "Balanced Quality",
}

const tagStyleMapper: Record<TagType, string> = {
  [TagType.Roleplay]: "bg-red-100 text-red-800",
  [TagType.Llama]: "bg-green-100 text-green-800",
  [TagType.Story]: "bg-blue-100 text-blue-800",
  [TagType.Casual]: "bg-yellow-100 text-yellow-800",
  [TagType.Professional]: "text-indigo-800 bg-indigo-100",
  [TagType.CodeLlama]: "bg-pink-100 text-pink-800",
  [TagType.Coding]: "text-purple-800 bg-purple-100",

  [TagType.Recommended]:
    "text-green-700 ring-1 ring-inset ring-green-600/20 bg-green-50",
  [TagType.Compatible]:
    "bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10",

  [TagType.SlowOnDevice]:
    "bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20",

  [TagType.Incompatible]:
    "bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10",
  [TagType.InsufficientRam]:
    "bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10",
  [TagType.TooLarge]: "bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10",

  [TagType.Medium]: "bg-yellow-100 text-yellow-800",
  [TagType.BalancedQuality]: "bg-yellow-100 text-yellow-800",
};

type Props = {
  title: string;
  type: TagType;
  clickable?: boolean;
  onClick?: () => void;
};

const SimpleTag: React.FC<Props> = ({
  onClick,
  clickable = true,
  title,
  type,
}) => {
  if (!clickable) {
    return (
      <div
        className={`px-[10px] py-0.5 rounded text-xs font-medium ${tagStyleMapper[type]}`}
      >
        {title}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`px-[10px] py-0.5 rounded text-xs font-medium ${tagStyleMapper[type]}`}
    >
      {title} x
    </button>
  );
};

export default React.memo(SimpleTag);

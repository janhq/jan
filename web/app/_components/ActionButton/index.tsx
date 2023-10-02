import React from "react";

type Props = {
  title: string;
  onClick: () => void;
  color: string;
  text?: string;
};

const ActionButton: React.FC<Props> = ({
  onClick,
  title,
  color,
  text = "text-white",
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 ${color} rounded-md shadow-sm border ${text} border-gray-300 hover:opacity-70`}
  >
    {title}
  </button>
);

export default ActionButton;

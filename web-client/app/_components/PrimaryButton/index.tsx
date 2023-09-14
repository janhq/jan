import React from "react";

type Props = {
  title: string;
  onClick: () => void;
  fullWidth?: boolean;
};

const PrimaryButton: React.FC<Props> = ({
  title,
  onClick,
  fullWidth = false,
}) => (
  <button
    onClick={onClick}
    type="button"
    className={`rounded-md bg-indigo-500 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-50 ${
      fullWidth ? "flex-1 " : ""
    }}`}
  >
    {title}
  </button>
);

export default PrimaryButton;

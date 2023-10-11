import React from "react";
import { TagType } from "./TagType";
import { tagStyleMapper } from "./TagStyleMapper";

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
        className={`px-2.5 py-0.5 rounded text-xs font-medium ${tagStyleMapper[type]}`}
      >
        {title}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-0.5 rounded text-xs font-medium ${tagStyleMapper[type]}`}
    >
      {title} x
    </button>
  );
};

export default React.memo(SimpleTag);

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
  if (!title || title.length === 0) return null;
  if (!clickable) {
    return (
      <div
        className={`px-2.5 py-0.5 rounded text-xs font-medium items-center line-clamp-1 max-w-[40%] ${tagStyleMapper[type]}`}
      >
        {title}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-0.5 rounded text-xs font-medium items-center line-clamp-1 max-w-[40%] ${tagStyleMapper[type]}`}
    >
      {title} x
    </button>
  );
};

export default React.memo(SimpleTag);

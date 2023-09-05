import React, { useState } from "react";
import { useStore } from "@/_models/RootStore";

type Props = {
  targetRef: React.RefObject<HTMLDivElement>;
};

export const Draggable: React.FC<Props> = ({ targetRef }) => {
  const { historyStore } = useStore();
  const [initialPos, setInitialPos] = useState<number | null>(null);
  const [initialSize, setInitialSize] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(0);

  const initial = (e: React.DragEvent<HTMLDivElement>) => {
    setInitialPos(e.clientX);
    setInitialSize(targetRef.current?.offsetWidth ?? 0);
  };

  const resize = (e: React.DragEvent<HTMLDivElement>) => {
    if (initialPos !== null && initialSize !== null) {
      setWidth(initialSize - (e.clientX - initialPos));
      targetRef.current!.style.width = `${width}px`;
    }
    if (width <= 270) {
      historyStore.closeModelDetail();
    }
  };

  return (
    <div
      className="absolute left-0 top-0 w-1 h-full cursor-ew-resize"
      draggable={true}
      onDrag={resize}
      onDragStart={initial}
    ></div>
  );
};

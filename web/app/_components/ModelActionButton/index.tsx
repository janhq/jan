import React from "react";
import ActionButton from "../ActionButton";

export enum ModelActionType {
  Start = "Start",
  Stop = "Stop",
}

type ModelActionStyle = {
  title: string;
  backgroundColor: string;
  textColor: string;
};

const modelActionMapper: Record<ModelActionType, ModelActionStyle> = {
  [ModelActionType.Start]: {
    title: "Start",
    backgroundColor: "bg-blue-500 hover:bg-blue-600",
    textColor: "text-white",
  },
  [ModelActionType.Stop]: {
    title: "Stop",
    backgroundColor: "bg-red-500 hover:bg-red-600",
    textColor: "text-white",
  },
};

type Props = {
  type: ModelActionType;
  onActionClick: (type: ModelActionType) => void;
};

const ModelActionButton: React.FC<Props> = ({ type, onActionClick }) => {
  const styles = modelActionMapper[type];
  const onClick = () => {
    onActionClick(type);
  };

  return (
    <td className="whitespace-nowrap px-6 py-4 text-sm">
      <ActionButton
        color={styles.backgroundColor}
        text={styles.textColor}
        onClick={onClick}
        title={styles.title}
      />
    </td>
  );
};

export default ModelActionButton;

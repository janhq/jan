import React from "react";
import { Product } from "@/_models/Product";
import Image from "next/image";
import { ModelStatus, ModelStatusComponent } from "../ModelStatusComponent";
import ModelActionMenu from "../ModelActionMenu";
import { useAtomValue } from "jotai";
import ModelActionButton, { ModelActionType } from "../ModelActionButton";
import useStartStopModel from "@/_hooks/useStartStopModel";
import useDeleteModel from "@/_hooks/useDeleteModel";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

type Props = {
  model: Product;
};

const ModelRow: React.FC<Props> = ({ model }) => {
  const { startModel, stopModel } = useStartStopModel();
  const activeModel = useAtomValue(currentProductAtom);
  const { deleteModel } = useDeleteModel();

  let status = ModelStatus.Installed;
  if (activeModel && activeModel.id === model.id) {
    status = ModelStatus.Active;
  }

  let actionButtonType = ModelActionType.Start;
  if (activeModel && activeModel.id === model.id) {
    actionButtonType = ModelActionType.Stop;
  }

  const onModelActionClick = (action: ModelActionType) => {
    if (action === ModelActionType.Start) {
      startModel(model.id);
    } else {
      stopModel(model.id);
    }
  };

  const onDeleteClick = () => {
    deleteModel(model);
  };

  return (
    <tr
      className="border-b border-gray-200 last:border-b-0 last:rounded-lg"
      key={model.id}
    >
      <td className="flex flex-col whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
        {model.name}
        <span className="text-gray-500 font-normal">{model.version}</span>
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
        <div className="flex flex-col justify-start">
          <span>{model.format}</span>
          {model.accelerated && (
            <span className="flex items-center text-gray-500 text-sm font-normal gap-0.5">
              <Image src={"/icons/flash.svg"} width={20} height={20} alt="" />
              GPU Accelerated
            </span>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
        {model.totalSize}
      </td>
      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
        <ModelStatusComponent status={status} />
      </td>
      <ModelActionButton
        type={actionButtonType}
        onActionClick={onModelActionClick}
      />
      <td className="relative whitespace-nowrap px-6 py-4 w-fit text-right text-sm font-medium">
        <ModelActionMenu onDeleteClick={onDeleteClick} />
      </td>
    </tr>
  );
};

export default ModelRow;

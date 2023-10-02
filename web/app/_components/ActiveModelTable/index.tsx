import { useAtomValue } from "jotai";
import React, { Fragment } from "react";
import ModelTable from "../ModelTable";
import { currentProductAtom } from "@/_helpers/atoms/Model.atom";

const ActiveModelTable: React.FC = () => {
  const activeModel = useAtomValue(currentProductAtom);

  if (!activeModel) return null;

  return (
    <Fragment>
      <h3 className="text-xl leading-[25px] mb-[13px]">Active Model(s)</h3>
      <ModelTable models={[activeModel]} />
    </Fragment>
  );
};

export default ActiveModelTable;

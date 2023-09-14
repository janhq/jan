import React from "react";

type Props = {
  name: string;
  description: string;
};

const ModelInfoItem: React.FC<Props> = ({ description, name }) => (
  <div className="flex flex-col flex-1">
    <span className="text-gray-500 font-normal text-sm">{name}</span>
    <span className="font-normal text-sm">{description}</span>
  </div>
);

export default React.memo(ModelInfoItem);

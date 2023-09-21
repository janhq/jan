import React from "react";

type Props = {
  inferenceTime: string;
  hardware: string;
  averageCostPerCall: string;
  onGetApiKeyClick: () => void;
};

const ModelDetailCost: React.FC<Props> = ({
  inferenceTime,
  hardware,
  averageCostPerCall,
  onGetApiKeyClick,
}) => {
  return <div>
    
  </div>;
};

export default ModelDetailCost;

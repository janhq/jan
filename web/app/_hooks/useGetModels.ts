import React, { useState } from "react";

export default function useGetModels() {
  const [models, setModels] = useState<any[]>()

  return {
    models
  };
}

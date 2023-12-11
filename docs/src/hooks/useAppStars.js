import React, { useEffect, useState } from "react";

import axios from "axios";
import { isAxiosError } from "axios";

export const useAppStars = () => {
  const [stargazers, setStargazers] = useState({
    count: 0,
  });

  useEffect(() => {
    const updateStargazers = async () => {
      try {
        const { data } = await axios.get(
          "https://api.github.com/repos/janhq/jan"
        );
        setStargazers({
          count: data.stargazers_count,
        });
      } catch (error) {
        if (isAxiosError(error)) {
          console.error("Failed to get stargazers:", error);
        }
      }
    };
    updateStargazers();
  }, []);

  return { stargazers };
};

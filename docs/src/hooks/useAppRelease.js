import React, { useEffect, useState } from "react";

import axios from "axios";

import { isAxiosError } from "axios";

export const useAppRelease = () => {
  const [release, setRelease] = useState({
    tagVersion: "",
  });

  useEffect(() => {
    const updateStargazers = async () => {
      try {
        const { data } = await axios.get(
          "https://api.github.com/repos/janhq/jan/releases/latest"
        );
        setRelease({
          tagVersion: data.tag_name,
        });
      } catch (error) {
        if (isAxiosError(error)) {
          console.error("Failed to get stargazers:", error);
        }
      }
    };
    updateStargazers();
  }, []);

  return { release };
};

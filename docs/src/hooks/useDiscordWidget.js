import React, { useEffect, useState } from "react";

import axios from "axios";
import { isAxiosError } from "axios";

export const useDiscordWidget = () => {
  const [data, setData] = useState({});

  useEffect(() => {
    const updateData = async () => {
      try {
        const { data } = await axios.get(
          "https://discord.com/api/guilds/1107178041848909847/widget.json"
        );
        setData({
          ...data,
        });
      } catch (error) {
        if (isAxiosError(error)) {
          console.error("Failed to get stargazers:", error);
        }
      }
    };
    updateData();
  }, []);

  return { data };
};

import { useEffect, useState } from "react";

export const useDiscordHook = () => {
  const [userAgent, setUserAgent] = useState(null);

  useEffect(() => {
    setUserAgent(navigator.userAgent);
  }, []);

  async function sendDiscordMessage(systemName) {
    try {
      const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

      const payload = {
        content: "",
        embeds: [
          {
            title: `New app download!\nArchitecture: ${systemName}`,
            description: userAgent,
            color: 16777215,
          },
        ],
      };

      await fetch(discordWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Error sending Discord webhook:", error);
    }
  }
  return { sendDiscordMessage };
};

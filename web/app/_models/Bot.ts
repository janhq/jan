export type Bot = {
  _id: string;
  name: string;
  description: string;
  visibleFromBotProfile: boolean;
  systemPrompt: string;
  welcomeMessage: string;
  publiclyAccessible: boolean;
  suggestReplies: boolean;
  renderMarkdownContent: boolean;

  /**
   * If true, the bot will use the custom temperature value instead of the
   * default temperature value.
   */
  enableCustomTemperature: boolean;

  /**
   * Default is 0.7.
   */
  customTemperature: number;

  modelId: string;
  createdAt?: number;
  updatedAt?: number;
};

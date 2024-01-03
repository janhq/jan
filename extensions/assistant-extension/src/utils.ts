const serializeChatHistory = (chatHistory: string | Array<string>) => {
  if (Array.isArray(chatHistory)) {
    return chatHistory.join("\n");
  }
  return chatHistory;
};

export enum PluginType {
  Conversational = "conversational",
  Inference = "inference",
  Preference = "preference",
  SystemMonitoring = "systemMonitoring",
  Model = "model",
}

export abstract class JanPlugin {
  abstract type(): PluginType;
  abstract onLoad(): void;
  abstract onUnload(): void;
}

import { JanPlugin } from "../plugin";

export abstract class MonitoringPlugin extends JanPlugin {
  abstract getResourcesInfo(): Promise<any>;
  abstract getCurrentLoad(): Promise<any>;
}

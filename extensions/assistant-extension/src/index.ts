import {
  ExtensionType,
  fs,
  Assistant,
  MessageRequest,
  events,
  EventName,
  InferenceEngine,
  Thread,
  joinPath,
  executeOnMain,
  AssistantExtension,
} from "@janhq/core";

export default class JanAssistantExtension implements AssistantExtension {
  private static readonly _homeDir = "file://assistants";

  controller = new AbortController();
  isCancelled = false;

  type(): ExtensionType {
    return ExtensionType.Assistant;
  }

  async onLoad() {
    // making the assistant directory
    if (!(await fs.existsSync(JanAssistantExtension._homeDir)))
      fs.mkdirSync(JanAssistantExtension._homeDir).then(() => {
        this.createJanAssistant();
      });

    // Events subscription
    events.on(EventName.OnMessageSent, (data: MessageRequest) =>
      JanAssistantExtension.handleMessageRequest(data, this)
    );

    events.on(EventName.OnInferenceStopped, () => {
      JanAssistantExtension.handleInferenceStopped(this);
    });

    events.on(EventName.OnThreadStarted, (data: MessageRequest) => {
      JanAssistantExtension.handleThreadStart(data, this);
    });

    events.on(EventName.OnFileUpload, (data: MessageRequest) => {
      JanAssistantExtension.handleFileUpload(data, this);
    });
  }

  private static async handleInferenceStopped(instance: JanAssistantExtension) {
    instance.isCancelled = true;
    instance.controller?.abort();
  }

  private static async handleThreadStart(
    // thread: Thread,
    data: MessageRequest,
    instance: JanAssistantExtension
  ) {
    // Load thread vector store into memory
    instance.isCancelled = false;
    instance.controller = new AbortController();

    if (data.model?.engine !== InferenceEngine.tool_retrieval_enabled) {
      return;
    }

    const retrievalResult = await executeOnMain(
      NODE,
      "toolRetrievalLoadThreadMemory",
      data
    );
    console.log(retrievalResult);
  }

  private static async handleFileUpload(
    data: MessageRequest,
    instance: JanAssistantExtension
  ) {
    instance.isCancelled = true;
    instance.controller?.abort();

    if (data.model?.engine !== InferenceEngine.tool_retrieval_enabled) {
      return;
    }

    const ingestionResult = await executeOnMain(
      NODE,
      "toolRetrievalIngestDocument",
      {
        messageRequest: data,
      }
    );

    console.log("get back data", ingestionResult);
  }

  private static async handleMessageRequest(
    data: MessageRequest,
    instance: JanAssistantExtension
  ) {
    instance.isCancelled = false;
    instance.controller = new AbortController();

    if (data.model?.engine !== InferenceEngine.tool_retrieval_enabled) {
      return;
    }

    const retrievalResult = await executeOnMain(
      NODE,
      "toolRetrievalQueryResult",
      data
    );

    console.log("get back data", retrievalResult);

    const output = {
      ...data,
      model: {
        ...data.model,
        // engine: data.model.proxyEngine,
        engine: InferenceEngine.testing,
      },
    };
    events.emit(EventName.OnMessageSent, output);
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantDir = await joinPath([
      JanAssistantExtension._homeDir,
      assistant.id,
    ]);
    if (!(await fs.existsSync(assistantDir))) await fs.mkdirSync(assistantDir);

    // store the assistant metadata json
    const assistantMetadataPath = await joinPath([
      assistantDir,
      "assistant.json",
    ]);
    try {
      await fs.writeFileSync(
        assistantMetadataPath,
        JSON.stringify(assistant, null, 2)
      );
    } catch (err) {
      console.error(err);
    }
  }

  async getAssistants(): Promise<Assistant[]> {
    // get all the assistant directories
    // get all the assistant metadata json
    const results: Assistant[] = [];
    const allFileName: string[] = await fs.readdirSync(
      JanAssistantExtension._homeDir
    );
    for (const fileName of allFileName) {
      const filePath = await joinPath([
        JanAssistantExtension._homeDir,
        fileName,
      ]);

      if (filePath.includes(".DS_Store")) continue;
      const jsonFiles: string[] = (await fs.readdirSync(filePath)).filter(
        (file: string) => file === "assistant.json"
      );

      if (jsonFiles.length !== 1) {
        // has more than one assistant file -> ignore
        continue;
      }

      const content = await fs.readFileSync(
        await joinPath([filePath, jsonFiles[0]]),
        "utf-8"
      );
      const assistant: Assistant =
        typeof content === "object" ? content : JSON.parse(content);

      results.push(assistant);
    }

    return results;
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    if (assistant.id === "jan") {
      return Promise.reject("Cannot delete Jan Assistant");
    }

    // remove the directory
    const assistantDir = await joinPath([
      JanAssistantExtension._homeDir,
      assistant.id,
    ]);
    await fs.rmdirSync(assistantDir);
    return Promise.resolve();
  }

  private async createJanAssistant(): Promise<void> {
    const janAssistant: Assistant = {
      avatar: "",
      thread_location: undefined,
      id: "jan",
      object: "assistant",
      created_at: Date.now(),
      name: "Jan",
      description: "A default assistant that can use all downloaded models",
      model: "*",
      instructions: "",
      tools: [
        {
          type: "retrieval",
          enabled: true,
          settings: {},
        },
      ],
      file_ids: [],
      metadata: undefined,
    };

    await this.createAssistant(janAssistant);
  }
}

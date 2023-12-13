import { ExtensionType, fs, Assistant } from "@janhq/core";
import { AssistantExtension } from "@janhq/core";
import { join } from "path";

export default class JanAssistantExtension implements AssistantExtension {
  private static readonly _homeDir = "assistants";

  type(): ExtensionType {
    return ExtensionType.Assistant;
  }

  onLoad(): void {
    // making the assistant directory
    fs.mkdir(JanAssistantExtension._homeDir).then(() => {
      this.createJanAssistant();
    });
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantDir = join(JanAssistantExtension._homeDir, assistant.id);
    await fs.mkdir(assistantDir);

    // store the assistant metadata json
    const assistantMetadataPath = join(assistantDir, "assistant.json");
    try {
      await fs.writeFile(
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
    const allFileName: string[] = await fs.listFiles(
      JanAssistantExtension._homeDir
    );
    for (const fileName of allFileName) {
      const filePath = join(JanAssistantExtension._homeDir, fileName);
      const isDirectory = await fs.isDirectory(filePath);
      if (!isDirectory) {
        // if not a directory, ignore
        continue;
      }

      const jsonFiles: string[] = (await fs.listFiles(filePath)).filter(
        (file: string) => file === "assistant.json"
      );

      if (jsonFiles.length !== 1) {
        // has more than one assistant file -> ignore
        continue;
      }

      const assistant: Assistant = JSON.parse(
        await fs.readFile(join(filePath, jsonFiles[0]))
      );

      results.push(assistant);
    }

    return results;
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    if (assistant.id === "jan") {
      return Promise.reject("Cannot delete Jan Assistant");
    }

    // remove the directory
    const assistantDir = join(JanAssistantExtension._homeDir, assistant.id);
    await fs.rmdir(assistantDir);
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
      tools: undefined,
      file_ids: [],
      metadata: undefined,
    };

    await this.createAssistant(janAssistant);
  }
}

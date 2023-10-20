/**
 * The entrypoint for the plugin.
 */

import {
  EventName,
  NewMessageRequest,
  PluginService,
  RegisterExtensionPoint,
  invokePluginFunc,
  events,
  preferences,
  store,
} from "@janhq/core";

/**
 * Register event listener.
 */
const registerListener = () => {
  events.on(EventName.OnNewMessageRequest, inferenceRequest);
};

/**
 * Invokes the `ingest` function from the `module.js` file using the `invokePluginFunc` method.
 * "ingest" is the name of the function to invoke.
 * @returns {Promise<any>} A promise that resolves with the result of the `run` function.
 */
function onStart(): Promise<void> {
  registerListener();
  ingest();
  return Promise.resolve();
}

/**
 * Retrieves the document ingestion directory path from the `preferences` module and invokes the `ingest` function
 * from the specified module with the directory path and additional options.
 * The additional options are retrieved from the `preferences` module using the `PLUGIN_NAME` constant.
 */
async function ingest() {
  const path = await preferences.get(PLUGIN_NAME, "ingestDocumentDirectoryPath");

  // TODO: Hiro - Add support for custom embeddings
  const customizedEmbedding = undefined;

  if (path && path.length > 0) {
    const openAPIKey = await preferences.get(PLUGIN_NAME, "openAIApiKey");
    const azureOpenAIBasePath = await preferences.get(PLUGIN_NAME, "azureOpenAIBasePath");
    const azureOpenAIApiInstanceName = await preferences.get(PLUGIN_NAME, "azureOpenAIApiInstanceName");
    invokePluginFunc(MODULE_PATH, "ingest", path, customizedEmbedding, {
      openAIApiKey: openAPIKey?.length > 0 ? openAPIKey : undefined,
      azureOpenAIApiKey: await preferences.get(PLUGIN_NAME, "azureOpenAIApiKey"),
      azureOpenAIApiVersion: await preferences.get(PLUGIN_NAME, "azureOpenAIApiVersion"),
      azureOpenAIApiInstanceName: azureOpenAIApiInstanceName?.length > 0 ? azureOpenAIApiInstanceName : undefined,
      azureOpenAIApiDeploymentName: await preferences.get(PLUGIN_NAME, "azureOpenAIApiDeploymentNameRag"),
      azureOpenAIBasePath: azureOpenAIBasePath?.length > 0 ? azureOpenAIBasePath : undefined,
    });
  }
}

/**
 * Retrieves the document ingestion directory path from the `preferences` module and invokes the `ingest` function
 * from the specified module with the directory path and additional options.
 * The additional options are retrieved from the `preferences` module using the `PLUGIN_NAME` constant.
 */
async function inferenceRequest(data: NewMessageRequest): Promise<any> {
  // TODO: Hiro - Add support for custom embeddings
  const customLLM = undefined;
  const message = {
    ...data,
    message: "",
    user: "RAG",
    createdAt: new Date().toISOString(),
    _id: undefined,
  };
  const id = await store.insertOne("messages", message);
  message._id = id;
  events.emit(EventName.OnNewMessageResponse, message);

  const openAPIKey = await preferences.get(PLUGIN_NAME, "openAIApiKey");
  const azureOpenAIBasePath = await preferences.get(PLUGIN_NAME, "azureOpenAIBasePath");
  const azureOpenAIApiInstanceName = await preferences.get(PLUGIN_NAME, "azureOpenAIApiInstanceName");
  invokePluginFunc(MODULE_PATH, "chatWithDocs", data.message, customLLM, {
    openAIApiKey: openAPIKey?.length > 0 ? openAPIKey : undefined,
    azureOpenAIApiKey: await preferences.get(PLUGIN_NAME, "azureOpenAIApiKey"),
    azureOpenAIApiVersion: await preferences.get(PLUGIN_NAME, "azureOpenAIApiVersion"),
    azureOpenAIApiInstanceName: azureOpenAIApiInstanceName?.length > 0 ? azureOpenAIApiInstanceName : undefined,
    azureOpenAIApiDeploymentName: await preferences.get(PLUGIN_NAME, "azureOpenAIApiDeploymentNameChat"),
    azureOpenAIBasePath: azureOpenAIBasePath?.length > 0 ? azureOpenAIBasePath : undefined,
    modelName: "gpt-3.5-turbo-16k",
    temperature: 0.2,
  }).then(async (text) => {
    console.log("RAG Response:", text);
    message.message = text;

    events.emit(EventName.OnMessageResponseUpdate, message);
  });
}
/**
 * Initializes the plugin by registering the extension functions with the given register function.
 * @param {Function} options.register - The function to use for registering the extension functions
 */
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(PluginService.OnStart, PLUGIN_NAME, onStart);
  register(PluginService.OnPreferencesUpdate, PLUGIN_NAME, ingest);

  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "ingestDocumentDirectoryPath",
    "Document Ingest Directory Path",
    "The URL of the directory containing the documents to ingest",
    undefined
  );

  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "openAIApiKey",
    "Open API Key",
    "OpenAI API Key",
    undefined
  );

  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "azureOpenAIApiKey",
    "Azure API Key",
    "Azure Project API Key",
    undefined
  );
  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "azureOpenAIApiVersion",
    "Azure API Version",
    "Azure Project API Version",
    undefined
  );
  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "azureOpenAIApiInstanceName",
    "Azure Instance Name",
    "Azure Project Instance Name",
    undefined
  );
  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "azureOpenAIApiDeploymentNameChat",
    "Azure Chat Model Deployment Name",
    "Azure Project Chat Model Deployment Name (e.g. gpt-3.5-turbo-16k)",
    undefined
  );
  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "azureOpenAIApiDeploymentNameRag",
    "Azure Text Embedding Model Deployment Name",
    "Azure Project Text Embedding Model Deployment Name (e.g. text-embedding-ada-002)",
    undefined
  );
  preferences.registerPreferences<string>(
    register,
    PLUGIN_NAME,
    "azureOpenAIBasePath",
    "Azure Base Path",
    "Azure Project Base Path",
    undefined
  );
}

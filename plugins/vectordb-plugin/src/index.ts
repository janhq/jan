/**
 * The entrypoint for the plugin.
 */

import { PluginService, RegisterExtensionPoint, core } from "@janhq/core";

/**
 * Invokes the `run` function from the `module.js` file using the `invokePluginFunc` method.
 * "run" is the name of the function to invoke.
 * @returns {Promise<any>} A promise that resolves with the result of the `run` function.
 */
function onStart(): Promise<void> {
  return Promise.resolve();
}

/**
 * Create a table on data store
 *
 * @param     table     name of the table to create
 * @param     schema   schema of the table to create, include fields and their types
 * @returns   Promise<void>
 *
 */
function createVectorTable(table: string, schema?: { [key: string]: any }): Promise<void> {
  return core.invokePluginFunc(PLUGIN_NAME, "createVectorTable", table, schema);
}
/**
 * Import db from documents
 *
 * @param     table              name of the table
 * @param     value              document to insert { docs, embeddedDocs }
 * @returns   Promise<any>
 *
 */
function fromDocuments(table: string, value: any): Promise<any> {
  return core.invokePluginFunc(PLUGIN_NAME, "fromDocuments", table, value);
}
/**
 * Performs a similarity search on the vectors in the database and returns
 * the documents and their scores.
 * @param query The query vector.
 * @param k The number of results to return.
 * @returns A Promise that resolves with an array of tuples, each containing a Document and its score.
 */
function similaritySearch(table: string, query: number[], k: number): Promise<[any, number][]> {
  return core.invokePluginFunc(PLUGIN_NAME, "similaritySearchVectorWithScore", table, query, k);
}

/**
 * Initializes the plugin by registering the extension functions with the given register function.
 * @param {Function} options.register - The function to use for registering the extension functions
 */
export function init({ register }: { register: RegisterExtensionPoint }) {
  register(PluginService.OnStart, PLUGIN_NAME, onStart);

  // TODO: Update exported services
  register("createVectorTable", PLUGIN_NAME, createVectorTable);
  register("fromDocuments", PLUGIN_NAME, fromDocuments);
  register("similaritySearch", PLUGIN_NAME, similaritySearch);
}

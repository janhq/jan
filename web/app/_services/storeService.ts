import { Core } from "@janhq/plugin-core";
import { executeSerial } from "./pluginService";

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @returns   Promise<void>
 *
 */
function createCollection(name: string): Promise<void> {
  return executeSerial(Core.StoreService.CreateCollection, name);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return executeSerial(Core.StoreService.DeleteCollection, name);
}

/**
 * Insert a value to a collection
 *
 * @param     collectionName     name of the collection
 * @param     value              value to insert
 * @returns   Promise<any>
 *
 */
function insertValue(collectionName: string, value: any): Promise<any> {
  return executeSerial(Core.StoreService.InsertValue, {
    collectionName,
    value,
  });
}

/**
 * Update value of a collection's record
 *
 * @param     collectionName     name of the collection
 * @param     key                key of the record to update
 * @param     value              value to update
 * @returns   Promise<void>
 *
 */
function updateValue(
  collectionName: string,
  key: string,
  value: any
): Promise<void> {
  return executeSerial(Core.StoreService.UpdateValue, {
    collectionName,
    key,
    value,
  });
}

/**
 * Delete a collection's record
 *
 * @param     collectionName     name of the collection
 * @param     key                key of the record to delete
 * @returns   Promise<void>
 *
 */
function deleteValue(collectionName: string, key: string): Promise<void> {
  return executeSerial(Core.StoreService.DeleteValue, { collectionName, key });
}

export const store = {
  createCollection,
  deleteCollection,
  insertValue,
  updateValue,
  deleteValue,
};

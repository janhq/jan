import { StoreService } from "@janhq/plugin-core";
import { executeSerial } from "./pluginService";

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @returns   Promise<void>
 *
 */
function createCollection(name: string): Promise<void> {
  return executeSerial(StoreService.CreateCollection, name);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return executeSerial(StoreService.DeleteCollection, name);
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
  return executeSerial(StoreService.InsertValue, {
    collectionName,
    value,
  });
}

/**
 * Retrieve all records from a collection in the data store.
 * @param {string} collectionName - The name of the collection to retrieve.
 * @returns {Promise<any>} A promise that resolves when all records are retrieved.
 */
function getAllValues(collectionName: string): Promise<any> {
  return executeSerial(StoreService.GetAllValues, collectionName);
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function getValue(collectionName: string, key: string): Promise<any> {
  return executeSerial(StoreService.GetValue, { collectionName, key });
}

/**
 * Gets records in a collection in the data store using a selector.
 * @param {string} collectionName - The name of the collection containing the record to get the value from.
 * @param {{ [key: string]: any }} selector - The selector to use to get the value from the record.
 * @returns {Promise<any>} A promise that resolves with the selected value.
 */
function getValuesBySelector(
  collectionName: string,
  selector: { [key: string]: any }
): Promise<any> {
  return executeSerial(StoreService.GetValuesBySelector, {
    collectionName,
    selector,
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
  return executeSerial(StoreService.UpdateValue, {
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
  return executeSerial(StoreService.DeleteValue, { collectionName, key });
}

export const store = {
  createCollection,
  deleteCollection,
  insertValue,
  updateValue,
  deleteValue,
  getAllValues,
  getValue,
  getValuesBySelector,
};

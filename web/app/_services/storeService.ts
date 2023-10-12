import { StoreService } from "@janhq/plugin-core";
import { executeSerial } from "./pluginService";

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @returns   {Promise<void>}
 *
 */
function createCollection(name: string): Promise<void> {
  return executeSerial(StoreService.CreateCollection, name);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   {Promise<void>}
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
 * @returns   {Promise<any>}
 *
 */
function insertOne(collectionName: string, value: any): Promise<any> {
  return executeSerial(StoreService.InsertOne, {
    collectionName,
    value,
  });
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function findOne(collectionName: string, key: string): Promise<any> {
  return executeSerial(StoreService.FindOne, { collectionName, key });
}

/**
 * Retrieves all records that match a selector in a collection in the data store.
 * @param   collectionName  - The name of the collection to retrieve.
 * @param   selector        - The selector to use to get records from the collection.
 * @param   sort            - The sort options to use to retrieve records.
 * @returns {Promise<any>}
 */
function findMany(
  collectionName: string,
  selector?: { [key: string]: any },
  sort?: [{ [key: string]: any }]
): Promise<any> {
  console.log("selector ne: ", selector);
  return executeSerial(StoreService.FindMany, {
    collectionName,
    selector,
    sort,
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
function updateOne(
  collectionName: string,
  key: string,
  value: any
): Promise<void> {
  return executeSerial(StoreService.UpdateOne, {
    collectionName,
    key,
    value,
  });
}

/**
 * Updates all records that match a selector in a collection in the data store.
 * @param collectionName - The name of the collection containing the records to update.
 * @param selector - The selector to use to get the records to update.
 * @param value - The new value for the records.
 * @returns {Promise<void>} A promise that resolves when the records are updated.
 */
function updateMany(
  collectionName: string,
  value: any,
  selector?: { [key: string]: any }
): Promise<void> {
  return executeSerial(StoreService.UpdateOne, {
    collectionName,
    value,
    selector,
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
function deleteOne(collectionName: string, key: string): Promise<void> {
  return executeSerial(StoreService.DeleteOne, { collectionName, key });
}

/**
 * Deletes all records with a matching key from a collection in the data store.
 * @param {string} collectionName - The name of the collection to delete the records from.
 * @param {{ [key: string]: any }} selector - The selector to use to get the records to delete.
 * @param {[{ [key: string]: any }]} sort - The sort options to use to retrieve records.
 * @returns {Promise<void>} A promise that resolves when the records are deleted.
 */
function deleteMany(
  collectionName: string,
  selector?: { [key: string]: any },
  sort?: [{ [key: string]: any }]
): Promise<void> {
  return executeSerial(StoreService.DeleteOne, {
    collectionName,
    selector,
    sort,
  });
}

export const store = {
  createCollection,
  deleteCollection,
  insertOne,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
  findOne,
  findMany,
};

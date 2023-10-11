/**
 * Creates, reads, updates, and deletes data in a data store.
 * @module
 */

/**
 * Creates a new collection in the data store.
 * @param {string}               name - The name of the collection to create.
 * @param { [key: string]: any } schema - schema of the collection to create, include fields and their types
 * @returns {Promise<void>} A promise that resolves when the collection is created.
 */
function createCollection(
  name: string,
  schema: { [key: string]: any }
): Promise<void> {
  return window.corePlugin?.store?.createCollection(name, schema);
}

/**
 * Deletes a collection from the data store.
 * @param {string} name - The name of the collection to delete.
 * @returns {Promise<void>} A promise that resolves when the collection is deleted.
 */
function deleteCollection(name: string): Promise<void> {
  return window.corePlugin?.store?.deleteCollection(name);
}

/**
 * Inserts a value into a collection in the data store.
 * @param {string} collectionName - The name of the collection to insert the value into.
 * @param {any} value - The value to insert into the collection.
 * @returns {Promise<any>} A promise that resolves with the inserted value.
 */
function insertValue(collectionName: string, value: any): Promise<any> {
  return window.corePlugin?.store?.insertValue(collectionName, value);
}

/**
 * Retrieve all records from a collection in the data store.
 * @param {string} collectionName - The name of the collection to retrieve.
 * @returns {Promise<any>} A promise that resolves when all records are retrieved.
 */
function getAllValues(collectionName: string): Promise<any> {
  return window.corePlugin?.store?.getAllValues(collectionName);
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function getValue(collectionName: string, key: string): Promise<any> {
  return window.corePlugin?.store?.getVale(collectionName, key);
}

/**
 * Retrieve records from a collection in the data store with selector.
 * @param {string} collectionName - The name of the collection containing records to retrieve.
 * @param {{ [key: string]: any }} selector - The selector to use to get records from the collection.
 * @returns {Promise<any>} A promise that resolves when records are retrieved.
 */
function getValuesBySelector(
  collectionName: string,
  selector: { [key: string]: any }
): Promise<any> {
  return window.corePlugin?.store?.getValuesBySelector(
    collectionName,
    selector
  );
}

/**
 * Updates the value of a record in a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to update.
 * @param {string} key - The key of the record to update.
 * @param {any} value - The new value for the record.
 * @returns {Promise<void>} A promise that resolves when the record is updated.
 */
function updateValue(
  collectionName: string,
  key: string,
  value: any
): Promise<void> {
  return window.corePlugin?.store?.updateValue(collectionName, key, value);
}

/**
 * Deletes a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to delete.
 * @param {string} key - The key of the record to delete.
 * @returns {Promise<void>} A promise that resolves when the record is deleted.
 */
function deleteValue(collectionName: string, key: string): Promise<void> {
  return window.corePlugin?.store?.deleteValue(collectionName, key);
}

/**
 * Exports the data store operations as an object.
 */
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

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
function insertOne(collectionName: string, value: any): Promise<any> {
  return window.corePlugin?.store?.insertOne(collectionName, value);
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function getOne(collectionName: string, key: string): Promise<any> {
  return window.corePlugin?.store?.getOne(collectionName, key);
}

/**
 * Retrieves all records that match a selector in a collection in the data store.
 * @param {string} collectionName - The name of the collection to retrieve.
 * @param {{ [key: string]: any }} selector - The selector to use to get records from the collection.
 * @param {[{ [key: string]: any }]} sort - The sort options to use to retrieve records.
 * @returns {Promise<any>} A promise that resolves when all records are retrieved.
 */
function getMany(
  collectionName: string,
  selector?: { [key: string]: any },
  sort?: [{ [key: string]: any }]
): Promise<any> {
  return window.corePlugin?.store?.getMany(collectionName, selector, sort);
}

/**
 * Updates the value of a record in a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to update.
 * @param {string} key - The key of the record to update.
 * @param {any} value - The new value for the record.
 * @returns {Promise<void>} A promise that resolves when the record is updated.
 */
function updateOne(
  collectionName: string,
  key: string,
  value: any
): Promise<void> {
  return window.corePlugin?.store?.updateOne(collectionName, key, value);
}

/**
 * Updates all records that match a selector in a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the records to update.
 * @param {{ [key: string]: any }} selector - The selector to use to get the records to update.
 * @param {any} value - The new value for the records.
 * @returns {Promise<void>} A promise that resolves when the records are updated.
 */
function updateMany(
  collectionName: string,
  value: any,
  selector?: { [key: string]: any }
): Promise<void> {
  return window.corePlugin?.store?.updateMany(collectionName, selector, value);
}

/**
 * Deletes a single record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to delete.
 * @param {string} key - The key of the record to delete.
 * @returns {Promise<void>} A promise that resolves when the record is deleted.
 */
function deleteOne(collectionName: string, key: string): Promise<void> {
  return window.corePlugin?.store?.deleteOne(collectionName, key);
}

/**
 * Deletes all records with a matching key from a collection in the data store.
 * @param {string} collectionName           - The name of the collection to delete the records from.
 * @param {{ [key: string]: any }} selector - The selector to use to get the records to delete.
 * @returns {Promise<void>}                 A promise that resolves when the records are deleted.
 */
function deleteMany(
  collectionName: string,
  selector?: { [key: string]: any }
): Promise<void> {
  return window.corePlugin?.store?.deleteMany(collectionName, selector);
}

/**
 * Exports the data store operations as an object.
 */
export const store = {
  createCollection,
  deleteCollection,
  insertOne,
  getOne,
  getMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
};

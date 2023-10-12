import { addRxPlugin, createRxDatabase, RxDatabase } from "rxdb";
import { getRxStorageLoki } from "rxdb/plugins/storage-lokijs";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
addRxPlugin(RxDBDevModePlugin);
/**
 * Get LokiJS Database Instance
 *
 * @returns   Promise<RxDatabase>
 *
 */
function getDb(): Promise<RxDatabase> {
  const db = createRxDatabase({
    name: "jandb",
    storage: getRxStorageLoki(),
    ignoreDuplicate: true,
  });
  return db;
}

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @param     schema   schema of the collection to create, include fields and their types
 * @returns   Promise<void>
 *
 */
function createCollection(
  name: string,
  schema: { [key: string]: any }
): Promise<void> {
  return getDb()
    .then((db) =>
      db.addCollections({
        [name]: {
          schema: {
            title: name,
            version: 0,
            primaryKey: "id",
            properties: schema,
            type: "object",
          },
        },
      })
    )
    .then(() => {});
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return getDb().then((db) => db[name].remove());
}

/**
 * Insert a value to a collection
 *
 * @param     collectionName     name of the collection
 * @param     value              value to insert
 * @returns   Promise<any>
 *
 */
function insertOne(collectionName: string, value: any): Promise<any> {
  return getDb().then((db) => db[collectionName].insert(value));
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
  return getDb().then((db) => db[collectionName].findOne(key).update(value));
}

/**
 * Update value of a collection's records
 *
 * @param     collectionName     name of the collection
 * @param     selector           selector of records to update
 * @param     value              value to update
 * @returns   Promise<void>
 *
 */
function updateMany(
  collectionName: string,
  value: any,
  selector?: { [key: string]: any }
): Promise<any> {
  return getDb().then((db) =>
    db[collectionName].find({ selector }).update(value)
  );
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
  return getDb().then((db) => db[collectionName].findOne(key).remove());
}

/**
 * Delete a collection records by selector
 *
 * @param   {string}                 collectionName   name of the collection
 * @param   {{ [key: string]: any }} selector         selector for retrieving records.
 * @returns   Promise<void>
 *
 */
function deleteMany(
  collectionName: string,
  selector?: { [key: string]: any }
): Promise<void> {
  return getDb()
    .then((db) => db[collectionName].find({ selector }).remove())
    .then();
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function getOne(collectionName: string, key: string): Promise<any> {
  return getDb().then((db) => db[collectionName].findOne(key));
}

/**
 * Gets records in a collection in the data store using a selector.
 * @param {string} collectionName - The name of the collection containing records to retrieve.
 * @param {{ [key: string]: any }} selector - The selector to use to retrieve records.
 * @param {[{ [key: string]: any }]} sort - The sort options to use to retrieve records.
 * @returns {Promise<any>} A promise that resolves with the selected records.
 */
function getMany(
  collectionName: string,
  selector?: { [key: string]: any },
  sort?: [{ [key: string]: any }]
): Promise<any> {
  return getDb().then((db) => db[collectionName].find({ selector, sort }));
}

module.exports = {
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

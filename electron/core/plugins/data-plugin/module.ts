var PouchDB = require("pouchdb-node");
PouchDB.plugin(require("pouchdb-find"));
var path = require("path");
var { app } = require("electron");
var fs = require("fs");

const dbs: Record<string, any> = {};

/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @param     schema   schema of the collection to create, include fields and their types
 * @returns   Promise<void>
 *
 */
function createCollection(name: string, schema: { [key: string]: any }): Promise<void> {
  return new Promise<void>((resolve) => {
    const dbPath = path.join(app.getPath("userData"), "databases");
    if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath);
    const db = new PouchDB(`${path.join(dbPath, name)}`);
    dbs[name] = db;
    resolve();
  });
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  // Do nothing with Unstructured Database
  return dbs[name].destroy();
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
  if (!value._id) return dbs[collectionName].post(value).then((doc) => doc.id);
  return dbs[collectionName].put(value).then((doc) => doc.id);
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
function updateOne(collectionName: string, key: string, value: any): Promise<void> {
  return dbs[collectionName].get(key).then((doc) => {
    return dbs[collectionName].put({
      _id: key,
      _rev: doc._rev,
      force: true,
      ...value,
    });
  });
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
function updateMany(collectionName: string, value: any, selector?: { [key: string]: any }): Promise<any> {
  // Creates keys from selector for indexing
  const keys = selector ? Object.keys(selector) : [];

  // At a basic level, there are two steps to running a query: createIndex()
  // (to define which fields to index) and find() (to query the index).
  return (
    keys.length > 0
      ? dbs[collectionName].createIndex({
          // There is selector so we need to create index
          index: { fields: keys },
        })
      : Promise.resolve()
  ) // No selector, so no need to create index
    .then(() =>
      dbs[collectionName].find({
        // Find documents using Mango queries
        selector,
      })
    )
    .then((data) => {
      const docs = data.docs.map((doc) => {
        // Update doc with new value
        return (doc = {
          ...doc,
          ...value,
        });
      });
      return dbs[collectionName].bulkDocs(docs);
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
  return findOne(collectionName, key).then((doc) => dbs[collectionName].remove(doc));
}

/**
 * Delete a collection records by selector
 *
 * @param   {string}                 collectionName   name of the collection
 * @param   {{ [key: string]: any }} selector         selector for retrieving records.
 * @returns   Promise<void>
 *
 */
function deleteMany(collectionName: string, selector?: { [key: string]: any }): Promise<void> {
  // Creates keys from selector for indexing
  const keys = selector ? Object.keys(selector) : [];

  // At a basic level, there are two steps to running a query: createIndex()
  // (to define which fields to index) and find() (to query the index).
  return (
    keys.length > 0
      ? dbs[collectionName].createIndex({
          // There is selector so we need to create index
          index: { fields: keys },
        })
      : Promise.resolve()
  ) // No selector, so no need to create index
    .then(() =>
      dbs[collectionName].find({
        // Find documents using Mango queries
        selector,
      })
    )
    .then((data) => {
      return Promise.all(
        // Remove documents
        data.docs.map((doc) => {
          return dbs[collectionName].remove(doc);
        })
      );
    });
}

/**
 * Retrieve a record from a collection in the data store.
 * @param {string} collectionName - The name of the collection containing the record to retrieve.
 * @param {string} key - The key of the record to retrieve.
 * @returns {Promise<any>} A promise that resolves when the record is retrieved.
 */
function findOne(collectionName: string, key: string): Promise<any> {
  return dbs[collectionName].get(key);
}

/**
 * Gets records in a collection in the data store using a selector.
 * @param {string} collectionName - The name of the collection containing records to retrieve.
 * @param {{ [key: string]: any }} selector - The selector to use to retrieve records.
 * @param {[{ [key: string]: any }]} sort - The sort options to use to retrieve records.
 * @returns {Promise<any>} A promise that resolves with the selected records.
 */
function findMany(
  collectionName: string,
  selector?: { [key: string]: any },
  sort?: [{ [key: string]: any }]
): Promise<any> {
  const keys = selector ? Object.keys(selector) : [];
  const sortKeys = sort ? sort.flatMap((e) => (e ? Object.keys(e) : undefined)) : [];

  // Note that we are specifying that the field must be greater than or equal to null
  // which is a workaround for the fact that the Mango query language requires us to have a selector.
  // In CouchDB collation order, null is the "lowest" value, and so this will return all documents regardless of their field value.
  sortKeys.forEach((key) => {
    if (!keys.includes(key)) {
      selector = { ...selector, [key]: { $gt: null } };
    }
  });

  // There is no selector & sort, so we can just use allDocs() to get all the documents.
  if (sortKeys.concat(keys).length === 0) {
    return dbs[collectionName]
      .allDocs({
        include_docs: true,
        endkey: "_design",
        inclusive_end: false,
      })
      .then((data) => data.rows.map((row) => row.doc));
  }
  // At a basic level, there are two steps to running a query: createIndex()
  // (to define which fields to index) and find() (to query the index).
  return dbs[collectionName]
    .createIndex({
      // Create index for selector & sort
      index: { fields: sortKeys.concat(keys) },
    })
    .then(() => {
      // Find documents using Mango queries
      return dbs[collectionName].find({
        selector,
        sort,
      });
    })
    .then((data) => data.docs); // Return documents
}

module.exports = {
  createCollection,
  deleteCollection,
  insertOne,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
};

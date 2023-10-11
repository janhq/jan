/**
 * Create a collection on data store
 *
 * @param     name     name of the collection to create
 * @returns   Promise<void>
 *
 */
function createCollection(name: string): Promise<void> {
  return window.corePlugin?.store?.createCollection(name);
}

/**
 * Delete a collection
 *
 * @param     name     name of the collection to delete
 * @returns   Promise<void>
 *
 */
function deleteCollection(name: string): Promise<void> {
  return window.corePlugin?.store?.deleteCollection(name);
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
  return window.corePlugin?.store?.insertValue(collectionName, value);
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
  return window.corePlugin?.store?.updateValue(collectionName, key, value);
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
  return window.corePlugin?.store?.deleteValue(collectionName, key);
}

/**
 * Operation exports
 */
export const store = {
  createCollection,
  deleteCollection,
  insertValue,
  updateValue,
  deleteValue,
};

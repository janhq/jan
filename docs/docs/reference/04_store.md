---
title: "store"
---

`store` is a helper object for working with Jan app's local storage database.

By default, Jan ships with a [pouchDB](https://pouchdb.com/) client side noSQL db to persist usage state.

_Note: default `store` logic is from [@data-plugin](https://www.npmjs.com/package/@janhq/data-plugin) which implements `StoreService`._

## Usage

```js
import { store } from "@janhq/core";
```

## Insert Data

You can use the store.insertOne function to insert data into a specific collection in the local data store.

```js
import { store } from "@janhq/core";

function insertData() {
  store.insertOne("conversations", { name: "meow" });
  // Insert a new document with { name: "meow" } into the "conversations" collection.
}
```

## Get Data

To retrieve data from a collection in the local data store, you can use the `store.findOne` or `store.findMany` function. It allows you to filter and retrieve documents based on specific criteria.

store.getOne(collectionName, key) retrieves a single document that matches the provided key in the specified collection.
store.getMany(collectionName, selector, sort) retrieves multiple documents that match the provided selector in the specified collection.

```js
import { store } from "@janhq/core";

function getData() {
  const selector = { name: "meow" };
  const data = store.findMany("conversations", selector);
  // Retrieve documents from the "conversations" collection that match the filter.
}
```

## Update Data

You can update data in the local store using these functions:

store.updateOne(collectionName, key, update) updates a single document that matches the provided key in the specified collection.
store.updateMany(collectionName, selector, update) updates multiple documents that match the provided selector in the specified collection.

```js
function updateData() {
  const selector = { name: "meow" };
  const update = { name: "newName" };
  store.updateOne("conversations", selector, update);
  // Update a document in the "conversations" collection.
}
```

## Delete Data

You can delete data from the local data store using these functions:

store.deleteOne(collectionName, key) deletes a single document that matches the provided key in the specified collection.
store.deleteMany(collectionName, selector) deletes multiple documents that match the provided selector in the specified collection.

```js
function deleteData() {
  const selector = { name: "meow" };
  store.deleteOne("conversations", selector);
  // Delete a document from the "conversations" collection.
}
```

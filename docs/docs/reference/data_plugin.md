---
sidebar_position: 1
title: "data plugin"
---

## Data Plugin

> This module provides functions for interacting with data storage using ([PouchDB](https://github.com/pouchdb/pouchdb)) as the underlying database.

## Usage

### Create a collection
In this example, we will create a collection named `my-collection` without schema. The database will be located as at: `AppData + /dabatases/my-collection`. AppData will depends on your OS where you install Jan app:
AppData Per-user application data directory, which by default points to:
* %APPDATA% on Windows
* $XDG_CONFIG_HOME or ~/.config on Linux
* ~/Library/Application Support on macOS
  
For example, the database location in macOS would be `/Users/$(whoami)/Library/Application\ Support/jan/databases/my-collection`
```js
const store = require("@janhq/core");
store.createCollection({ name: "my-collection", schema: {} });
```
### Delete a collection
Delete `my-collection` database.
```js
const store = require("@janhq/core");
store.deleteCollection({"my-collection"});
```
### Create a document
In this example, we'll create a document in `my-collection` database. The document comprises 3 field : `_id: string` ,  `name: string`, `age: number`. The `insertOne` function will return inserted id.
```js
const store = require("@janhq/core");
const id = await store.insertOne("my-collection", {_id: "1", name: "Jan", age: 1});
// id = 1
```

### Find one document
In the previous step, we just created a document with `_id:"1"`. Let's try how to find it.
```js
const store = require("@janhq/core");
const doc = await store.findOne("my-collection","1");
// {name: 'Jan', age: 1, _id: '1'}
```

### Find many documents and sort the result
In this example, we will find all the documents that have `age >= 1` with `$gte` operator and sort the result by name in descending order.
```js
const store = require("@janhq/core");
const id1 = await store.insertOne("my-collection", {_id: "1", name: "Jan", age: 1});
const id2 = await store.insertOne("my-collection", {_id: "2", name: "James", age: 1});
const id3 = await store.insertOne("my-collection", {_id: "3", name: "Jack", age: 2});
const docs = await store.findMany("my-collection", {age: { $gte: 1 }}, [{ name : "desc"}]);
// [{"name":"Jan","age":1,"_id":"1",},
// {"name":"James","age":1,"_id":"2"},
// {"name":"Jack","age":2,"_id":"3"}]
```
For more operators, please follow:
* $lt Match fields “less than” this one.
* $gt Match fields “greater than” this one.
* $lte Match fields “less than or equal to” this one.
* $gte Match fields “greater than or equal to” this one.
* $eq Match fields equal to this one.
* $ne Match fields not equal to this one.
* $exists True if the field should exist, false otherwise.
* $type One of: “null”, “boolean”, “number”, “string”, “array”, or “object”.
* $in The document field must exist in the list provided.
* $and Matches if all the selectors in the array match.
* $nin The document field must not exist in the list provided.
* $all Matches an array value if it contains all the elements of the argument array.
* $size Special condition to match the length of an array field in a document.
* $or Matches if any of the selectors in the array match. All selectors must use the same index.
* $nor Matches if none of the selectors in the array match.
* $not Matches if the given selector does not match.
* $mod Matches documents where (field % Divisor == Remainder) is true, and only when the document field is an integer.
* $regex A regular expression pattern to match against the document field.
* $elemMatch Matches all documents that contain an array field with at least one element that matches all the specified query criteria.

### Update a document
In this example, we will change the age from `1 to 5` in the document that has the id of `"1"`
```js
const store = require("@janhq/core");
const id = await store.insertOne("my-collection", {_id: "1", name: "Jan", age: 1});
await store.updateOne("my-collection", "1", {name: "Jan", age: 5});
```

### Update many documents
In this example, we will update the age to `10` in the documents that have `age >= 1`
```js
const store = require("@janhq/core");
const id1 = await store.insertOne("my-collection", {_id: "1", name: "Jan", age: 1});
const id2 = await store.insertOne("my-collection", {_id: "2", name: "James", age: 1});
const id3 = await store.insertOne("my-collection", {_id: "3", name: "Jack", age: 2});
const docs = await store.updateMany("my-collection", {age:10}, {age: { $gte : 1 }});
// [{"name":"Jan","age":10,"_id":"1",},
// {"name":"James","age":10,"_id":"2"},
// {"name":"Jack","age":10,"_id":"3"}]
```
For more operators, please follow:
* $lt Match fields “less than” this one.
* $gt Match fields “greater than” this one.
* $lte Match fields “less than or equal to” this one.
* $gte Match fields “greater than or equal to” this one.
* $eq Match fields equal to this one.
* $ne Match fields not equal to this one.
* $exists True if the field should exist, false otherwise.
* $type One of: “null”, “boolean”, “number”, “string”, “array”, or “object”.
* $in The document field must exist in the list provided.
* $and Matches if all the selectors in the array match.
* $nin The document field must not exist in the list provided.
* $all Matches an array value if it contains all the elements of the argument array.
* $size Special condition to match the length of an array field in a document.
* $or Matches if any of the selectors in the array match. All selectors must use the same index.
* $nor Matches if none of the selectors in the array match.
* $not Matches if the given selector does not match.
* $mod Matches documents where (field % Divisor == Remainder) is true, and only when the document field is an integer.
* $regex A regular expression pattern to match against the document field.
* $elemMatch Matches all documents that contain an array field with at least one element that matches all the specified query criteria.

### Delete a document
Delete the document which has id of `"1"`
```js
const store = require("@janhq/core");
const id1 = await store.insertOne("my-collection", {_id: "1", name: "Jan", age: 1});
const doc = await store.deleteOne("my-collection","1");
```
### Delete many documents
In this exmaple, we will delete documents that have `age < 2`
```js
const store = require("@janhq/core");
const id1 = await store.insertOne("my-collection", {_id: "1", name: "Jan", age: 1});
const id2 = await store.insertOne("my-collection", {_id: "2", name: "James", age: 1});
const id3 = await store.insertOne("my-collection", {_id: "3", name: "Jack", age: 2});
const docs = await store.deleteMany("my-collection", {age: {$lt : 2}});
```
For more operators, please follow:
* $lt Match fields “less than” this one.
* $gt Match fields “greater than” this one.
* $lte Match fields “less than or equal to” this one.
* $gte Match fields “greater than or equal to” this one.
* $eq Match fields equal to this one.
* $ne Match fields not equal to this one.
* $exists True if the field should exist, false otherwise.
* $type One of: “null”, “boolean”, “number”, “string”, “array”, or “object”.
* $in The document field must exist in the list provided.
* $and Matches if all the selectors in the array match.
* $nin The document field must not exist in the list provided.
* $all Matches an array value if it contains all the elements of the argument array.
* $size Special condition to match the length of an array field in a document.
* $or Matches if any of the selectors in the array match. All selectors must use the same index.
* $nor Matches if none of the selectors in the array match.
* $not Matches if the given selector does not match.
* $mod Matches documents where (field % Divisor == Remainder) is true, and only when the document field is an integer.
* $regex A regular expression pattern to match against the document field.
* $elemMatch Matches all documents that contain an array field with at least one element that matches all the specified query criteria.

## How to contribute
1. Go to [Jan](https://github.com/janhq/jan)
2. Create an Issue for plugins
3. Create a PR  to `main` branch
4. Once it's merged, the new model will be on Jan plugin to use.

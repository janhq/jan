## @janhq/core

> The module includes functions for communicating with core APIs, registering plugin extensions, and exporting type definitions.

## Usage

### Import the package

```js
// javascript
const core = require('@janhq/core')

// typescript
import * as core from '@janhq/core'
```

### Register Plugin Extensions

Every plugin must define an `init` function in its main entry file to initialize the plugin and register its extensions with the Jan platform.

You can `register` any function as a plugin extension using `CoreServiceAPI` below. For example, the `DataService.GetConversations` entry name can be used to register a function that retrieves conversations.

Once the extension is registered, it can be used by other plugins or components in the Jan platform. For example, a UI component might use the DataService.GetConversations extension to retrieve a list of conversations to display to the user.

```js
import { RegisterExtensionPoint, DataService } from "@janhq/core";

function getConversations() {
  // Your logic here
}

export function init({ register }: { register: RegisterExtensionPoint }) {
  register(DataService.GetConversations, getConversations.name, getConversations);
}
```

### Interact with Local Data Storage

The Core API allows you to interact with local data storage. Here are a couple of examples of how you can use it:

#### Insert Data

You can use the store.insertOne function to insert data into a specific collection in the local data store.

```js
import { store } from '@janhq/core'

function insertData() {
  store.insertOne('conversations', { name: 'meow' })
  // Insert a new document with { name: "meow" } into the "conversations" collection.
}
```

#### Get Data

To retrieve data from a collection in the local data store, you can use the `store.findOne` or `store.findMany` function. It allows you to filter and retrieve documents based on specific criteria.

store.getOne(collectionName, key) retrieves a single document that matches the provided key in the specified collection.
store.getMany(collectionName, selector, sort) retrieves multiple documents that match the provided selector in the specified collection.

```js
import { store } from '@janhq/core'

function getData() {
  const selector = { name: 'meow' }
  const data = store.findMany('conversations', selector)
  // Retrieve documents from the "conversations" collection that match the filter.
}
```

#### Update Data

You can update data in the local store using these functions:

store.updateOne(collectionName, key, update) updates a single document that matches the provided key in the specified collection.
store.updateMany(collectionName, selector, update) updates multiple documents that match the provided selector in the specified collection.

```js
function updateData() {
  const selector = { name: 'meow' }
  const update = { name: 'newName' }
  store.updateOne('conversations', selector, update)
  // Update a document in the "conversations" collection.
}
```

#### Delete Data

You can delete data from the local data store using these functions:

store.deleteOne(collectionName, key) deletes a single document that matches the provided key in the specified collection.
store.deleteMany(collectionName, selector) deletes multiple documents that match the provided selector in the specified collection.

```js
function deleteData() {
  const selector = { name: 'meow' }
  store.deleteOne('conversations', selector)
  // Delete a document from the "conversations" collection.
}
```

### Events

You can subscribe to NewMessageRequest events by defining a function to handle the event and registering it with the events object:

```js
import { events } from "@janhq/core";

function handleMessageRequest(message: NewMessageRequest) {
  // Your logic here. For example:
  // const response = openai.createChatCompletion({...})
}
function registerListener() {
  events.on(EventName.OnNewMessageRequest, handleMessageRequest);
}
// Register the listener function with the relevant extension points.
export function init({ register }) {
  registerListener();
}
```

In this example, we're defining a function called handleMessageRequest that takes a NewMessageRequest object as its argument. We're also defining a function called registerListener that registers the handleMessageRequest function as a listener for NewMessageRequest events using the on method of the events object.

```js
import { events } from "@janhq/core";

function handleMessageRequest(data: NewMessageRequest) {
  // Your logic here. For example:
   const response = openai.createChatCompletion({...})
   const message: NewMessageResponse = {
    ...data,
    message: response.data.choices[0].message.content
   }
  // Now emit event so the app can display in the conversation
   events.emit(EventName.OnNewMessageResponse, message)
}
```

### Preferences

To register plugin preferences, you can use the preferences object from the @janhq/core package. Here's an example of how to register and retrieve plugin preferences:

```js
import { PluginService, preferences } from "@janhq/core";

const pluginName = "your-first-plugin";
const preferenceKey = "";
const preferenceName = "Your First Preference";
const preferenceDescription = "This is for example only";
const defaultValue = "";

export function init({ register }: { register: RegisterExtensionPoint }) {
  // Register preference update handlers. E.g. update plugin instance with new configuration
  register(PluginService.OnPreferencesUpdate, pluginName, onPreferencesUpdate);

  // Register plugin preferences. E.g. Plugin need apiKey to connect to your service
  preferences.registerPreferences <
    string >
    (register, pluginName, preferenceKey, preferenceName, preferenceDescription, defaultValue);
}
```

In this example, we're registering preference update handlers and plugin preferences using the preferences object. We're also defining a PluginName constant to use as the name of the plugin.

To retrieve the values of the registered preferences, we're using the get method of the preferences object and passing in the name of the plugin and the name of the preference.

```js
import { preferences } from "@janhq/core";

const pluginName = "your-first-plugin";
const preferenceKey = "apiKey";

const setup = async () => {
  // Retrieve apiKey
  const apiKey: string = (await preferences.get(pluginName, preferenceKey)) ?? "";
};
```

### Access Core API

To access the Core API in your plugin, you can follow the code examples and explanations provided below.

##### Import Core API and Store Module

In your main entry code (e.g., `index.ts`), start by importing the necessary modules and functions from the `@janhq/core` library.

```js
// index.ts
import * as core from '@janhq/core'
```

#### Perform File Operations

The Core API also provides functions to perform file operations. Here are a couple of examples:

#### Download a File

You can download a file from a specified URL and save it with a given file name using the core.downloadFile function.

```js
function downloadModel(url: string, fileName: string) {
  core.downloadFile(url, fileName);
}
```

#### Delete a File

To delete a file, you can use the core.deleteFile function, providing the path to the file you want to delete.

```js
function deleteModel(filePath: string) {
  core.deleteFile(path);
}
```

#### Execute plugin module in main process

To execute a plugin module in the main process of your application, you can follow the steps outlined below.

##### Import the `core` Object

In your main process code (e.g., `index.ts`), start by importing the `core` object from the `@janhq/core` library.

```js
// index.ts
import * as core from '@janhq/core'
```

##### Define the Module Path

Specify the path to the plugin module you want to execute. This path should lead to the module file (e.g., module.js) that contains the functions you wish to call.

```js
// index.ts
const MODULE_PATH = 'data-plugin/dist/module.js'
```

##### Define the Function to Execute

Create a function that will execute a function defined in your plugin module. In the example provided, the function `getConversationMessages` is created to invoke the `getConvMessages` function from the plugin module.

```js
// index.ts
function getConversationMessages(id: number) {
  return core.invokePluginFunc(MODULE_PATH, "getConvMessages", id);
}

export function init({ register }: { register: RegisterExtensionPoint }) {
  register(DataService.GetConversationMessages, getConversationMessages.name, getConversationMessages);
}
```

##### Define Your Plugin Module

In your plugin module (e.g., module.ts), define the logic for the function you wish to execute. In the example, the function getConvMessages is defined with a placeholder comment indicating where your logic should be implemented.

```js
// module.ts
function getConvMessages(id: number) {
  // Your logic here
}

module.exports = {
  getConvMessages,
};
```

## CoreService API

The `CoreService` type is an exported union type that includes:

- `StoreService`
- `DataService`
- `InferenceService`
- `ModelManagementService`
- `SystemMonitoringService`
- `PreferenceService`

## StoreService

The `StoreService` enum represents available methods for managing the database store. It includes the following methods:

- `CreateCollection`: Creates a new collection in the data store.
- `DeleteCollection`: Deletes an existing collection from the data store.
- `InsertOne`: Inserts a new value into an existing collection in the data store.
- `UpdateOne`: Updates an existing value in an existing collection in the data store.
- `UpdateMany`: Updates multiple records in a collection in the data store.
- `DeleteOne`: Deletes an existing value from an existing collection in the data store.
- `DeleteMany`: Deletes multiple records in a collection in the data store.
- `FindMany`: Retrieves multiple records from a collection in the data store.
- `FindOne`: Retrieves a single record from a collection in the data store.

## DataService

The `DataService` enum represents methods related to managing conversations and messages. It includes the following methods:

- `GetConversations`: Gets a list of conversations from the data store.
- `CreateConversation`: Creates a new conversation in the data store.
- `DeleteConversation`: Deletes an existing conversation from the data store.
- `CreateMessage`: Creates a new message in an existing conversation in the data store.
- `UpdateMessage`: Updates an existing message in an existing conversation in the data store.
- `GetConversationMessages`: Gets a list of messages for an existing conversation from the data store.

## InferenceService

The `InferenceService` enum exports:

- `InitModel`: Initializes a model for inference.
- `StopModel`: Stops a running inference model.

## ModelManagementService

The `ModelManagementService` enum provides methods for managing models:

- `GetDownloadedModels`: Gets a list of downloaded models.
- `GetAvailableModels`: Gets a list of available models from data store.
- `DeleteModel`: Deletes a downloaded model.
- `DownloadModel`: Downloads a model from the server.
- `SearchModels`: Searches for models on the server.
- `GetConfiguredModels`: Gets configured models from the data store.
- `StoreModel`: Stores a model in the data store.
- `UpdateFinishedDownloadAt`: Updates the finished download time for a model in the data store.
- `GetUnfinishedDownloadModels`: Gets a list of unfinished download models from the data store.
- `GetFinishedDownloadModels`: Gets a list of finished download models from the data store.
- `DeleteDownloadModel`: Deletes a downloaded model from the data store.
- `GetModelById`: Gets a model by its ID from the data store.

## PreferenceService

The `PreferenceService` enum provides methods for managing plugin preferences:

- `ExperimentComponent`: Represents the UI experiment component for a testing function.

## SystemMonitoringService

The `SystemMonitoringService` enum includes methods for monitoring system resources:

- `GetCurrentLoad`: Gets the current system load.

## PluginService

The `PluginService` enum includes plugin cycle handlers:

- `OnStart`: Handler for starting. E.g. Create a collection.
- `OnPreferencesUpdate`: Handler for preferences update. E.g. Update instances with new configurations.

For more detailed information on each of these components, please refer to the source code.

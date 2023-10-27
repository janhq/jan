---
sidebar_position: 1
title: "CoreService"
---

`CoreService` provides an interface for implementing custom methods in Jan.
It lets you define shared behavior across your custom application, like your app handles state, models, or inferencing behavior.

## Usage

```js
import { CoreService, ... } from "@janhq/core";
```

## CoreService

The `CoreService` type bundles the following services:

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

- `GetResourcesInfo`: Gets information about system resources.
- `GetCurrentLoad`: Gets the current system load.

## PluginService

The `PluginService` enum includes plugin cycle handlers:

- `OnStart`: Handler for starting. E.g. Create a collection.
- `OnPreferencesUpdate`: Handler for preferences update. E.g. Update instances with new configurations.

For more detailed information on each of these components, please refer to the source code.

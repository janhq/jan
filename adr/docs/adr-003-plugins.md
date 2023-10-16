## JAN service & plugin APIs

Jan frontend components will communicate with plugin functions via Service Interfaces:


All of the available APIs are listed in [CoreService](../../web/shared/coreService.ts)

- Data Service:
    - GET_CONVERSATIONS: retrieve all of the conversations
    - CREATE_CONVERSATION: start a new conversation
    - DELETE_CONVERSATION: delete an existing conversation
    - GET_CONVERSATION_MESSAGES: retrieve a certain conversation messages
    - CREATE_MESSAGE: store a new message (both sent & received) 
    - UPDATE_MESSAGE: update an existing message (streaming)
    - STORE_MODEL: store new model information (when clicking download)
    - UPDATE_FINISHED_DOWNLOAD: mark a model as downloaded
    - GET_UNFINISHED_DOWNLOAD_MODELS: retrieve all unfinished downloading model (TBD)
    - GET_FINISHED_DOWNLOAD_MODELS: retrieve all finished downloading model (TBD)
    - DELETE_DOWNLOAD_MODEL: delete a model (TBD)
    - GET_MODEL_BY_ID: retrieve model information by its ID

- Inference Service:
    - INFERENCE_URL: retrieve inference endpoint served by plugin
    - INIT_MODEL: runs a model
    - STOP_MODEL: stop a running model

- Model Management Service: (TBD)
    - GET_AVAILABLE_MODELS: retrieve available models (deprecate soon)
    - GET_DOWNLOADED_MODELS: (deprecated)
    - DELETE_MODEL: (deprecated)
    - DOWNLOAD_MODEL: start to download a model
    - SEARCH_MODELS: explore models with search query on HuggingFace (TBD)

- Monitoring service:
    - GET_RESOURCES_INFORMATION: retrieve total & used memory information
    - GET_CURRENT_LOAD_INFORMATION: retrieve CPU load information


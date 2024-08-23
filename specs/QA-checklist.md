# Regression test

**Release Version:** v0.6.0

**Operating System:**

---

## A. Installation, Update, and Uninstallation

### 1. Users install app (New user flow)

- [ ] :rocket: Installation package is not corrupted and passes all security checks.
- [ ] :key: App launches successfully after installation.

### 2. Users update app (Existing user flow)

- [ ] :key: Validate that the update does not corrupt user data or settings.
- [ ] :key: App restarts or prompts the user to restart after an update.
- [ ] When updating the app, check if the `/models` directory has any JSON/YML files that change according to the update.
- [ ] Updating the app also updates extensions correctly, test functionality changes.

### 3. Users uninstall / close app

- [ ] :key: After closing the app, all models are unloaded.
- [ ] :key::warning: Uninstallation process removes the app successfully from the system.
- [ ] Clean the data folder and open the app to check if it creates all the necessary folders, especially models and extensions.


## B. Overview

### 1. Shortcut key

- [ ] :key: Test each shortcut key to confirm it works as described (My models, navigating, opening, closing, etc.).

### 2. Users check the `active model`

- [ ] :key: The app correctly displays the state of the loading model (e.g., loading, ready, error).
- [ ] :key: Confirm that the app allows users to switch between models if multiple are available.
- [ ] Check that the app provides feedback or instructions if the model fails to load.
- [ ] Verify the troubleshooting assistant correctly capture hardware / log info [#1784](https://github.com/janhq/jan/issues/1784)

## C. Thread

### 1. Users can chat with Jan, the default assistant

- [ ] :key: Sending a message enables users to receive responses from model.
- [ ] :key: Conversation thread is maintained without any loss of data upon sending multiple messages.
- [ ] ‌Users should be able to edit msg and the assistant will re-generate the answer based on the edited version of the message.
- [ ] Test for the ability to send different types of messages (e.g., text, emojis, code blocks).
- [ ] Check the output format of the AI (code blocks, JSON, markdown, ...).
- [ ] :key: Validate the scroll functionality in the chat window for lengthy conversations.
- [ ] User can copy / delete the response.
- [ ] :key: Check the `clear message` / `delete entire chat` button works.
- [ ] Deleting all the chat retains the model instruction and settings.
- [ ] :key: Appropriate error handling and messaging if the assistant fails to respond.
- [ ] Test assistant's ability to maintain context over multiple exchanges.
- [ ] :key: Check the `create new chat` button, and new conversation will have an automatically generated thread title based on users msg.
- [ ] Changing `models` mid-thread the app can still handle it.
- [ ] Check the `regenerate` button renews the response (single / multiple times).
- [ ] Check the `Instructions` update correctly after the user updates it midway (mid-thread).

### 2. Users can customize chat settings like model parameters via both the GUI & model.yml

- [ ] Adjust model parameters (e.g., Temperature, Top K, Top P) from the GUI and verify they are reflected in the chat behavior.
- [ ] :key: Changes can be saved and persisted between sessions.
- [ ] Users can access and modify the model.yml file.
- [ ] :key: Changes made in model.yml are correctly applied to the chat session upon reload or restart.
- [ ] Check the maximum and minimum limits of the adjustable parameters and how they affect the assistant's responses.
- [ ] :key: Users switch between threads with different models, the app can handle it.

### 3. Model dropdown
- :key: Model list should highlight recommended based on user RAM (this is not really correct, I think it's based on static formula)
- [ ] Model size should display (for both installed and imported models)

### 4. Users can click on a history thread
- [ ] Chat window displays the entire conversation from the selected history thread without any missing messages.
- [ ] Historical threads reflect the exact state of the chat at that time, including settings.
- [ ] :key: Ability to delete or clean old threads.
- [ ] Changing the title of the thread updates correctly.

### 5. Users can config instructions for the assistant.
- [ ] Instructions set by the user are being followed by the assistant in subsequent conversations.
- [ ] :key: Changes to instructions are updated in real time and do not require a restart of the application or session.
- [ ] :key: Ability to reset instructions to default or clear them completely.
- [ ] :key: RAG - Users can import documents and the system should process queries about the uploaded file, providing accurate and appropriate responses in the conversation thread.
- [ ] :key: Jan can see - Users can import image and Model with vision can generate responses (e.g. LLaVa model). [#294](https://github.com/janhq/jan/issues/294)


## D. Hub

### 1. Users can discover recommended models
- :key: Each model's recommendations are consistent with the user’s activity and preferences.
- [ ] Search models and verify results / action on the results

### 2. Users can download models suitable for their devices, e.g. compatible with their RAM

- [ ] Model list should be in order: Featured > Remote > Local
- [ ] :key: Ensure that models are labeled with RAM requirements.
- [ ] :key: Check the download model functionality and validate if the cancel download feature works correctly.

### 3. Users can download models via a HuggingFace URL [#1740](https://github.com/janhq/jan/issues/1740)

- [ ] :key: Import via Hugging Face Id / full HuggingFace URL, check the progress bar reflects the download process
- [ ] :key: Test deeplink import [#2876](https://github.com/janhq/jan/issues/2876)
- [ ] :key: Users can use / remove the imported model.

### 4. Users can import new models to the Hub

- [ ] :key: Ensure import successfully via drag / drop or upload GGUF.
- [ ] :key: Verify Move model binary file / Keep Original Files & Symlink option are working
- [ ] Users can add more info to the imported model / edit name
- [ ] :key: Ensure the new model updates after restarting the app.


### 5. Users can use the model as they want

- [ ] :key: Check `start` / `stop` / `delete`  button response exactly what it does.
- [ ] Check if starting another model stops the other model entirely.
- [ ] :rocket: Navigate to `hub` > Click `Use` button to use model. Expect to jump to thread and see the model in dropdown model selector.
- [ ] :key: Check when deleting a model it will delete all the files on the user's computer.
- [ ] :warning:The recommended tags should present right for the user's hardware.

### 6. Users can Integrate With a Remote Server
- [ ] :key: Import openAI GPT model https://jan.ai/guides/using-models/integrate-with-remote-server/ and the model displayed in Hub / Thread dropdown
- [ ] Users can use the remote model properly (openAI GPT, Groq)

## E. System Monitor

### 1. Users can see disk and RAM utilization

- [ ] :key: Verify that the RAM and VRAM utilization graphs  accurately reported in real time.
- [ ] :key: Validate that the utilization percentages reflect the actual usage compared to the system's total available resources.
- [ ] :key: Ensure that the system monitors updates dynamically as the models run and stop.

### 2. Users can start and stop models based on system health

- [ ] :key: Verify the `Start/Stop` action for a model, the system resource usage reflects this change.
- [ ] Confirm that any changes in model status (start/stop) are logged or reported to the user for transparency.
- [ ] :key: Check the functionality of `App log` to ensure it opens the correct folder in the system file explorer.

## F. Settings

### 1. Appearance

- [ ] :key: Test the `Light`, `Dark`, and `System` theme settings to ensure they are functioning as expected.
- [ ] Confirm that the application saves the theme preference and persists it across sessions.
- [ ] Validate that all elements of the UI are compatible with the theme changes and maintain legibility and contrast.

### 2. Extensions [TBU]

- Validate the `Install Extensions` process by selecting and installing a plugin file.
- [ ] Enable / disable extensions and the UI should reflex accordingly

### 3. Extension group

- [ ] :key: Users can set valid Endpoint and API Key to use remote models
- [ ] Monitoring extension should allow users to enable / disable log and set log Cleaning Interval


### 4. Advanced settings

- [ ] :key: Test the `Experimental Mode` toggle to confirm it enables or disables experimental features as intended.
- [ ] :key: Check the functionality of `Open App Directory` to ensure it opens the correct folder in the system file explorer.
- [ ] Users can move **Jan data folder**
- [ ] Validate that changes in advanced settings are applied immediately or provide appropriate instructions if a restart is needed.
- [ ] Attemp to test downloading model from hub using **HTTP Proxy** [guideline](https://github.com/janhq/jan/pull/1562)
- [ ] Logs that are older than 7 days or exceed 1MB in size will be automatically cleared upon starting the application.
- [ ] Users can click on Reset button to **factory reset** app settings to its original state & delete all usage data.
    - [ ] Keep the current app data location
    - [ ] Reset the current app data location
- [ ] Users can enable the setting and chat using quick ask.

### 5. Engine
- [ ] :key: TensorRT Engine - Users able to chat with the model
- [ ] :key: Onnx Engine - Users able to chat with the model
- [ ] :key: Other remote Engine - Users able to chat with the model

## G. Local API server

### 1. Local Server Usage with Server Options
- [ ] :key: Explore API Reference: Swagger API for sending/receiving requests
    - [ ] Use default server option
    - [ ] Configure and use custom server options
- [ ] Test starting/stopping the local API server with different Model/Model settings
- [ ] Server logs captured with correct Server Options provided
- [ ] Verify functionality of Open logs/Clear feature
- [ ] Ensure that threads and other functions impacting the model are disabled while the local server is running

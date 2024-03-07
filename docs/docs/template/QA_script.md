# Regression test

**Release Version:** v0.4.7

**Operating System:** MacOS

---

## A. Installation, Update, and Uninstallation

### 1. Users install app

- [ ] Check that the installation package is not corrupted and passes all security checks.
- [ ] :key: Confirm that the app launches successfully after installation.

### 2. Users update app

- [ ] :key: Validate that the update does not corrupt user data or settings.
- [ ] :key: Confirm that the app restarts or prompts the user to restart after an update.
- [ ] When updating the app, check if the `/models` directory has any JSON files that change according to the update.
- [ ] Verify if updating the app also updates extensions correctly (test functionality changes, support notifications for necessary tests with each version related to extensions update).

### 3. Users uninstall / close app

- [ ] :key: Ensure that after closing the app, all models are unloaded.
- [ ] :key::warning: Check that the uninstallation process removes the app successfully from the system.
- [ ] Clean the Jan root directory and open the app to check if it creates all the necessary folders, especially models and extensions.


## B. Overview

### 1. Shortcut key, memory usage / CPU usage

- [ ] :key: Test each shortcut key to confirm it works as described (My models, navigating, opening, closing, etc.).
- [ ] :key: Ensure that the interface presents the correct numbers for memory and CPU usage.

### 2. Users check the `active model`

- [ ] :key: Verify that the app correctly displays the state of the loading model (e.g., loading, ready, error).
- [ ] :key: Confirm that the app allows users to switch between models if multiple are available.
- [ ] Check that the app provides feedback or instructions if the model fails to load.
- [ ] Verify the troubleshooting assistant correctly capture hardware / log info #1784

## C. Thread

### 1. Users can chat with Jan, the default assistant

- [ ] :key: Verify sending a message enables users to receive responses from model.
- [ ] :key: Ensure that the conversation thread is maintained without any loss of data upon sending multiple messages.
- [ ] ‌Users should be able to edit msg and the assistant will re-generate the answer based on the edited version of the message.
- [ ] Test for the ability to send different types of messages (e.g., text, emojis, code blocks).
- [ ] Check the output format of the AI (code blocks, JSON, markdown, ...).
- [ ] :key: Validate the scroll functionality in the chat window for lengthy conversations.
- [ ] Check if the user can copy / delete the response.
- [ ] :key: Check the `clear message` / `delete entire chat` button works.
- [ ] Check if deleting all the chat retains the system prompt.
- [ ] :key: Validate that there is appropriate error handling and messaging if the assistant fails to respond.
- [ ] Test assistant's ability to maintain context over multiple exchanges.
- [ ] :key: Check the `create new chat` button, and new conversation will have an automatically generated thread title based on users msg.
- [ ] Confirm that by changing `models` mid-thread the app can still handle it.
- [ ] Check the `regenerate` button renews the response (single / multiple times).
- [ ] Check the `Instructions` update correctly after the user updates it midway (mid-thread).

### 2. Users can customize chat settings like model parameters via both the GUI & thread.json

- [ ] Test the functionality to adjust model parameters (e.g., Temperature, Top K, Top P) from the GUI and verify they are reflected in the chat behavior.
- [ ] :key: Ensure that changes can be saved and persisted between sessions.
- [ ] Validate that users can access and modify the thread.json file.
- [ ] :key: Check that changes made in thread.json are correctly applied to the chat session upon reload or restart.
- [ ] Check the maximum and minimum limits of the adjustable parameters and how they affect the assistant's responses.
- [ ] :key: Ensure that users switch between threads with different models, the app can handle it.

### 3. Model dropdown
- [ ] :key: Model list should highlight recommended based on user RAM
- [ ] Model size should display (for both installed and imported models)

### 4. Users can click on a history thread
- [ ] Confirm that the chat window displays the entire conversation from the selected history thread without any missing messages.
- [ ] :key: Check the performance and accuracy of the history feature when dealing with a large number of threads.
- [ ] Validate that historical threads reflect the exact state of the chat at that time, including settings.
- [ ] :key: Verify the ability to delete or clean old threads.
- [ ] Confirm that changing the title of the thread updates correctly.

### 5. Users can config instructions for the assistant.
- [ ] Test if the instructions set by the user are being followed by the assistant in subsequent conversations.
- [ ] :key: Validate that changes to instructions are updated in real time and do not require a restart of the application or session.
- [ ] :key: Check for the ability to reset instructions to default or clear them completely.
- [ ] :key: RAG - Users can import documents and the system should process queries about the uploaded file, providing accurate and appropriate responses in the conversation thread.


## D. Hub

### 1. Users can discover recommended models (Jan ships with a few preconfigured model.json files)

- [ ] :key: Ensure that each model's recommendations are consistent with the user’s activity and preferences.
- [ ] Test the functionality of any filters that refine model recommendations.

### 2. Users can download models suitable for their devices, e.g. compatible with their RAM

- [ ] Display the best model for their RAM at the top.
- [ ] :key: Ensure that models are labeled with RAM requirements and compatibility.
- [ ] :key: Check the download model functionality and validate if the cancel download feature works correctly.

### 3. Users can download models via a HuggingFace URL (coming soon)

- [ ] :key: Have the warning/status when the user enters the URL.
- [ ] :key: Check the progress bar reflects the right process.
- [ ] Validate the error handling for invalid or inaccessible URLs.

### 4. Users can import new models to the Hub

- [ ] :key: Ensure import successfully via drag / drop or upload GGUF.
- [ ] :key: Verify Move model binary file / Keep Original Files & Symlink option are working
- [ ] :warning: Ensure it raises clear errors for users to fix the problem while adding a new model.
- [ ] Users can add more info to the imported model / edit name
- [ ] :key: Ensure the new model updates after restarting the app.

### 5. Users can use the model as they want

- [ ] :key: Check `start` / `stop` / `delete`  button response exactly what it does.
- [ ] Check if starting another model stops the other model entirely.
- [x] :rocket: Check the `Explore models` navigate correctly to the model panel.
- [ ] :key: Check when deleting a model it will delete all the files on the user's computer.
- [ ] :warning:The recommended tags should present right for the user's hardware.

### 6. Users can Integrate With a Remote Server
- [ ] :key: Import openAI GPT model https://jan.ai/guides/using-models/integrate-with-remote-server/ and the model displayed in Hub / Thread dropdown
- [ ] Users can use the remote model properly

## E. System Monitor

### 1. Users can see disk and RAM utilization

- [ ] :key: Verify that the RAM and VRAM utilization graphs display accurate information.
- [ ] :key: Check that the CPU usage is accurately reported in real time.
- [ ] :key: Validate that the utilization percentages reflect the actual usage compared to the system's total available resources.
- [ ] :key: Ensure that the system monitors updates dynamically as the models run and stop.

### 2. Users can start and stop models based on system health

- [ ] :key: Test the 'Start' action for a model to ensure it initiates and the system resource usage reflects this change.
- [ ] :key: Verify the 'Stop' action for a model to confirm it ceases operation and frees up the system resources accordingly.
- [ ] Confirm that any changes in model status (start/stop) are logged or reported to the user for transparency.

## F. Settings

### 1. Appearance

- [ ] :key: Test the `Light`, `Dark`, and `System` theme settings to ensure they are functioning as expected.
- [ ] Confirm that the application saves the theme preference and persists it across sessions.
- [ ] Validate that all elements of the UI are compatible with the theme changes and maintain legibility and contrast.

### 2. Extensions [TBU]

- [ ] Confirm that the `Extensions` tab lists all available plugins.
- [x] :key: Test the toggle switch for each plugin to ensure it enables or disables the plugin correctly.
- [x] Verify that plugin changes take effect without needing to restart the application unless specified.
- [x] :key: Check that the plugin's status (`Installed the latest version`) updates accurately after any changes.
- [x] Validate the `Manual Installation` process by selecting and installing a plugin file.
- [x] Test for proper error handling and user feedback when a plugin installation fails.

### 3. Users can add custom plugins via manual installation [TBU]

- [x] Verify that the `Manual Installation` option is clearly visible and accessible in the `Extensions` section.
- [x] Test the functionality of the `Select` button within the `Manual Installation` area.
- [x] :warning: Check that the file picker dialog allows for the correct plugin file types (e.g., .tgz).
- [x] :key: Validate that the selected plugin file installs correctly and the plugin becomes functional.
- [x] Ensure that there is a progress indicator or confirmation message once the installation is complete.
- [x] Confirm that if the installation is interrupted or fails, the user is given a clear error message.
- [x] :key: Test that the application prevents the installation of incompatible or corrupt plugin files.
- [x] :key: Check that the user can uninstall or disable custom plugins as easily as pre-installed ones.
- [x] Verify that the application's performance remains stable after the installation of custom plugins.

### 4. Advanced settings

- [ ] :key: Test the `Experimental Mode` toggle to confirm it enables or disables experimental features as intended.
- [ ] :key: Check the functionality of `Open App Directory` to ensure it opens the correct folder in the system file explorer.
- [ ] Users can move **Jan data folder**
- [ ] Validate that changes in advanced settings are applied immediately or provide appropriate instructions if a restart is needed.
- [ ] Attemp to test downloading model from hub using **HTTP Proxy** [guideline](https://github.com/janhq/jan/pull/1562)
- [ ] Logs that are older than 7 days or exceed 1MB in size will be automatically cleared upon starting the application.
- [ ] Users can click on Reset button to **factory reset** app settings to its original state & delete all usage data.

## G. Local API server

### 1. Local Server Usage with Server Options
- [ ] :key: Explore API Reference: Swagger API for sending/receiving requests
    - [ ] Use default server option
    - [ ] Configure and use custom server options
- [ ] Test starting/stopping the local API server with different Model/Model settings
- [ ] Server logs captured with correct Server Options provided
- [ ] Verify functionality of Open logs/Clear feature
- [ ] Ensure that threads and other functions impacting the model are disabled while the local server is running

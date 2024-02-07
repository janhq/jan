# [Release Version] QA Script 

**Release Version:** v0.4.6

**Operating System:**

---

## A. Installation, Update, and Uninstallation

### 1. Users install app

- [ ] :key: Test for clear user installation instructions.
- [ ] :key: Verify that the installation path is correct for each OS.
- [ ] Check that the installation package is not corrupted and passes all security checks.
- [ ] Validate that the app is correctly installed in the default or user-specified directory.
- [ ] Ensure that all necessary dependencies are installed along with the app.
- [ ] :key: :rocket: Confirm that the app launches successfully after installation.

### 2. Users update app

- [ ] :key: Test that the updated version includes the new features or fixes outlined in the update notes.
- [ ] :key: Validate that the update does not corrupt user data or settings.
- [ ] :key: Confirm that the app restarts or prompts the user to restart after an update.

### 3. Users uninstall app

- [ ] :key::warning: Check that the uninstallation process removes the app successfully from the system.
- [ ] Clean the Jan root directory and open the app to check if it creates all the necessary folders, especially models and extensions.
- [ ] When updating the app, check if the `/models` directory has any JSON files that change according to the update.
- [ ] Verify if updating the app also updates extensions correctly (test functionality changes, support notifications for necessary tests with each version related to extensions update).

### 4. Users close app

- [ ] :key: Ensure that after closing the app, all models are unloaded.

## B. Overview

### 1. Users use shortcut keys

- [ ] :key: Test each shortcut key to confirm it works as described (My models, navigating, opening, closing, etc.).

### 2. Users check the memory usage and CPU usage

- [ ] :key: Ensure that the interface presents the correct numbers for memory and CPU usage.

### 3. Users check the `active model`

- [ ] :key: Verify that the app correctly displays the state of the loading model (e.g., loading, ready, error).
- [ ] :key: Confirm that the app allows users to switch between models if multiple are available.
- [ ] Check that the app provides feedback or instructions if the model fails to load.

## C. Thread

### 1. Users can chat with Jan, the default assistant

- [ ] Verify that the input box for messages is present and functional.
- [ ] :key: Check if typing a message and hitting `Send` results in the message appearing in the chat window.
- [ ] :key: Confirm that Jan, the default assistant, replies to user inputs.
- [ ] :key: Ensure that the conversation thread is maintained without any loss of data upon sending multiple messages.
- [ ] Test for the ability to send different types of messages (e.g., text, emojis, code blocks).
- [ ] :key: Validate the scroll functionality in the chat window for lengthy conversations.
- [ ] Check if the user can copy the response.
- [ ] Check if the user can delete responses.
- [ ] :key: Check the `clear message` button works.
- [ ] :key: Check the `delete entire chat` works.
- [ ] Check if deleting all the chat retains the system prompt.
- [ ] Check the output format of the AI (code blocks, JSON, markdown, ...).
- [ ] :key: Validate that there is appropriate error handling and messaging if the assistant fails to respond.
- [ ] Test assistant's ability to maintain context over multiple exchanges.
- [ ] :key: Check the `create new chat` button works correctly
- [ ] Confirm that by changing `models` mid-thread the app can still handle it.
- [ ] Check the `regenerate` button renews the response (single / multiple times).
- [ ] Check the `Instructions` update correctly after the user updates it midway (mid-thread).

### 2. Users can customize chat settings like model parameters via both the GUI & thread.json

- [ ] :key: Confirm that the Threads settings options are accessible.
- [ ] Test the functionality to adjust model parameters (e.g., Temperature, Top K, Top P) from the GUI and verify they are reflected in the chat behavior.
- [ ] :key: Ensure that changes can be saved and persisted between sessions.
- [ ] Validate that users can access and modify the thread.json file.
- [ ] :key: Check that changes made in thread.json are correctly applied to the chat session upon reload or restart.
- [ ] Check the maximum and minimum limits of the adjustable parameters and how they affect the assistant's responses.
- [ ] :key: Validate user permissions for those who can change settings and persist them.
- [ ] :key: Ensure that users switch between threads with different models, the app can handle it.

### 3. Model dropdown
- [ ] :key: Model list should highlight recommended based on user RAM
- [ ] Model size should display (for both installed and imported models)

### 4. Users can click on a history thread
- [ ] Test the ability to click on any thread in the history panel.
- [ ] :key: Verify that clicking a thread brings up the past conversation in the main chat window.
- [ ] :key: Ensure that the selected thread is highlighted or otherwise indicated in the history panel.
- [ ] Confirm that the chat window displays the entire conversation from the selected history thread without any missing messages.
- [ ] :key: Check the performance and accuracy of the history feature when dealing with a large number of threads.
- [ ] Validate that historical threads reflect the exact state of the chat at that time, including settings.
- [ ] :key: Verify the ability to delete or clean old threads.
- [ ] :key: Confirm that changing the title of the thread updates correctly.

### 5. Users can config instructions for the assistant.
- [ ] Ensure there is a clear interface to input or change instructions for the assistant.
- [ ] Test if the instructions set by the user are being followed by the assistant in subsequent conversations.
- [ ] :key: Validate that changes to instructions are updated in real time and do not require a restart of the application or session.
- [ ] :key: Confirm that the assistant's behavior changes in accordance with the new instructions provided.
- [ ] :key: Check for the ability to reset instructions to default or clear them completely.
- [ ] :key: Test the feature that allows users to save custom sets of instructions for different scenarios.
- [ ] Validate that instructions can be saved with descriptive names for easy retrieval.
- [ ] :key: Check if the assistant can handle conflicting instructions and how it resolves them.
- [ ] Ensure that instruction configurations are documented for user reference.
- [ ] :key: RAG - Users can import documents and the system should process queries about the uploaded file, providing accurate and appropriate responses in the conversation thread.


## D. Hub

### 1. Users can discover recommended models (Jan ships with a few preconfigured model.json files)

- [ ] :key: Verify that recommended models are displayed prominently on the main page.
- [ ] :key: Ensure that each model's recommendations are consistent with the user’s activity and preferences.
- [ ] Test the functionality of any filters that refine model recommendations.

### 2. Users can download models suitable for their devices, e.g. compatible with their RAM

- [ ] Display the best model for their RAM at the top.
- [ ] :key: Ensure that models are labeled with RAM requirements and compatibility.
- [ ] :warning: Test that the platform provides alternative recommendations for models not suitable due to RAM limitations.
- [ ] :key: Check the download model functionality and validate if the cancel download feature works correctly.

### 3. Users can download models via a HuggingFace URL (coming soon)

- [ ] :key: Have the warning/status when the user enters the URL.
- [ ] :key: Check the progress bar reflects the right process.
- [ ] Validate the error handling for invalid or inaccessible URLs.

### 4. Users can add a new model to the Hub

- [ ] :key: Have clear instructions so users can do their own.
- [ ] :key: Ensure the new model updates after restarting the app.
- [ ] :warning:Ensure it raises clear errors for users to fix the problem while adding a new model.

### 5. Users can use the model as they want

- [ ] :key: Check `start` button response exactly what it does.
- [ ] :key: Check `stop` button response exactly what it does.
- [ ] :key: Check `delete` button response exactly what it does.
- [ ] Check if starting another model stops the other model entirely.
- [ ] Check the `Explore models` navigate correctly to the model panel.
- [ ] :key: Check when deleting a model it will delete all the files on the user's computer.
- [ ] :warning:The recommended tags should present right for the user's hardware.
- [ ] Assess that the descriptions of models are accurate and informative.

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
- [ ] :key: Check the functionality that allows starting a model based on available system resources.
- [ ] :key: Validate that the system prevents starting a new model if it exceeds safe resource utilization thresholds.
- [ ] Ensure that the system provides warnings or recommendations when resource utilization is high before starting new models.
- [ ] Test the ease of accessing model settings from the system monitor for resource management.
- [ ] Confirm that any changes in model status (start/stop) are logged or reported to the user for transparency.

## F. Settings

### 1. Users can set color themes and dark/ light modes

- [ ] Verify that the theme setting is easily accessible in the `Appearance` tab.
- [ ] :key: Check that the theme change is reflected immediately upon selection.
- [ ] :key: Test the `Light`, `Dark`, and `System` theme settings to ensure they are functioning as expected.
- [ ] Confirm that the application saves the theme preference and persists it across sessions.
- [ ] Validate that all elements of the UI are compatible with the theme changes and maintain legibility and contrast.

### 2. Users change the extensions [TBU]

- [ ] Confirm that the `Extensions` tab lists all available plugins.
- [ ] :key: Test the toggle switch for each plugin to ensure it enables or disables the plugin correctly.
- [ ] Verify that plugin changes take effect without needing to restart the application unless specified.
- [ ] :key: Check that the plugin's status (`Installed the latest version`) updates accurately after any changes.
- [ ] Validate the `Manual Installation` process by selecting and installing a plugin file.
- [ ] Test for proper error handling and user feedback when a plugin installation fails.

### 3. Users change the advanced settings

- [ ] :key: Test the `Experimental Mode` toggle to confirm it enables or disables experimental features as intended.
- [ ] :key: Check the functionality of `Open App Directory` to ensure it opens the correct folder in the system file explorer.
- [ ] Validate that changes in advanced settings are applied immediately or provide appropriate instructions if a restart is needed.
- [ ] Test the application's stability when experimental features are enabled.

### 4. Users can add custom plugins via manual installation [TBU]

- [ ] Verify that the `Manual Installation` option is clearly visible and accessible in the `Extensions` section.
- [ ] Test the functionality of the `Select` button within the `Manual Installation` area.
- [ ] :warning: Check that the file picker dialog allows for the correct plugin file types (e.g., .tgz).
- [ ] :key: Validate that the selected plugin file installs correctly and the plugin becomes functional.
- [ ] Ensure that there is a progress indicator or confirmation message once the installation is complete.
- [ ] Confirm that if the installation is interrupted or fails, the user is given a clear error message.
- [ ] :key: Test that the application prevents the installation of incompatible or corrupt plugin files.
- [ ] :key: Check that the user can uninstall or disable custom plugins as easily as pre-installed ones.
- [ ] Verify that the application's performance remains stable after the installation of custom plugins.

### 5. Advanced Settings
- [ ] Attemp to test downloading model from hub using **HTTP Proxy** [guideline](https://github.com/janhq/jan/pull/1562)
- [ ] Users can move **Jan data folder**
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

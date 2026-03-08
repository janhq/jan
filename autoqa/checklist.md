# I. Before release 

## A. Initial update / migration Data check

Before testing, set-up the following in the old version to make sure that we can see the data is properly migrated:
- [ ] Changing Interface / theme to something that is obviously different from default set-up 
- [ ] Ensure there are a few chat threads
- [ ] Ensure there are a few favourites / star threads 
- [ ] Ensure there are 2 model downloaded 
- [ ] Ensure there are 2 import on local provider (llama.cpp) 
- [ ] Modify MCP servers list and add some ENV value to MCP servers
- [ ] Modify Local API Server 
- [ ] HTTPS proxy config value 
- [ ] Add 2 custom assistants to Jan 
- [ ] Create a new chat with the custom assistant 
- [ ] Change the `App Data` to some other folder
- [ ] Create a Custom Provider 
- [ ] Disabled some model providers
- [NEW] Change llama.cpp setting of 2 models 
#### Validate that the update does not corrupt existing user data or settings (before and after update show the same information):
- [ ] Threads
	- [ ] Previously used model and assistants is shown correctly 
	- [ ] Can resume chat in threads with the previous context 
- [ ] Assistants
- Settings:
	- [ ] Interface 
	- [ ] MCP Servers 
	- [ ] Local API Server 
	- [ ] HTTPS Proxy
- [ ] Custom Provider Set-up

#### In `Hub`:
- [ ] Can see model from HF listed properly 
- [ ] Downloaded model will show `Use` instead of `Download` 
- [ ] Toggling on `Downloaded` on the right corner show the correct list of downloaded models 

#### In `Settings -> General`:
- [ ] Ensure the `App Data` path is the same  
- [ ] Click Open Logs, App Log will show 
	
#### In `Settings -> Model Providers`:
- [ ] Llama.cpp still listed downloaded models and user can chat with the models
- [ ] Llama.cpp still listed imported models and user can chat with the models
- [ ] Remote model still retain previously set up API keys and user can chat with model from the provider without having to re-enter API keys
- [ ] Enabled and Disabled Model Providers stay the same as before update 

#### In `Settings -> Extensions`, check that following exists:
- [ ] Conversational 
- [ ] Jan Assistant
- [ ] Download Manager 
- [ ] llama.cpp Inference Engine

## B. `Settings` 

#### In `General`:
- [ ] Ensure `Community` links work and point to the correct website 
- [ ] Ensure the `Check for Updates` function detect the correct latest version 
- [ ] [ENG] Create a folder with un-standard character as title (e.g. Chinese character) => change the `App data` location to that folder => test that model is still able to load and run properly.
#### In `Interface`:
- [ ] Toggle between different `Theme` options to check that they change accordingly and that all elements of the UI are legible with the right contrast:
	- [ ] Light 
	- [ ] Dark 
	- [ ] System (should follow your OS system settings) 
- [ ] Change the following values => close the application => re-open the application => ensure that the change is persisted across session:
	- [ ] Theme
	- [ ] Font Size
	- [ ] Window Background
	- [ ] App Main View
	- [ ] Primary
	- [ ] Accent
	- [ ] Destructive
	- [ ] Chat Width
		- [ ] Ensure that when this value is changed, there is no broken UI caused by it
	- [ ] Code Block
	- [ ] Show Line Numbers
- [ENG] Ensure that when click on `Reset` in the `Interface` section, it reset back to the default values
- [ENG] Ensure that when click on `Reset` in the `Code Block` section, it reset back to the default values

#### In `Model Providers`:

In `Llama.cpp`:
- [ ] After downloading a model from hub, the model is listed with the correct name under `Models`
- [ ] Can import `gguf` model with no error
- [ ] Imported model will be listed with correct name under the `Models`
- [ ] Check that when click `delete` the model will be removed from the list
- [ ] Deleted model doesn't appear in the selectable models section in chat input (even in old threads that use the model previously)
- [ ] Ensure that user can re-import deleted imported models
- [ ] Enable `Auto-Unload Old Models`, and ensure that only one model can run / start at a time. If there are two model running at the time of enable, both of them will be stopped. 
- [ ] Disable `Auto-Unload Old Models`, and ensure that multiple models can run at the same time.
- [ ] Enable  `Context Shift` and ensure that context can run for long without encountering memory error. Use the `banana test` by turn on fetch MCP => ask local model to fetch and summarize the history of banana (banana has a very long history on wiki it turns out). It should run out of context memory sufficiently fast if `Context Shift` is not enabled.
- [ ] Ensure that user can change the Jinja chat template of individual model and it doesn't affect the template of other model
- [ ] Ensure that there is a recommended `llama.cpp` for each system and that it works out of the box for users.
- [ ] [0.6.9] Take a `gguf` file and delete the `.gguf` extensions from the file name, import it into Jan and verify that it works.

In Remote Model Providers:
- [ ] Check that the following providers are presence:
	- [ ] OpenAI
	- [ ] Anthropic
	- [ ] Cohere
	- [ ] OpenRouter
	- [ ] Mistral
	- [ ] Groq
	- [ ] Gemini
	- [ ] Hugging Face
- [ ] Models should appear as available on the selectable dropdown in chat input once some value is input in the API key field. (it could be the wrong API key)
- [ ] Once a valid API key is used, user can select a model from that provider and chat without any error. 
- [ ] Delete a model and ensure that it doesn't show up in the `Modesl` list view or in the selectable dropdown in chat input.
- [ ] Ensure that a deleted model also not selectable or appear in old threads that used it.
- [ ] Adding of new model manually works and user can chat with the newly added model without error (you can add back the model you just delete for testing)
- [ ] [0.6.9] Make sure that Ollama set-up  as a custom provider work with Jan
In Custom Providers:
- [ ] Ensure that user can create a new custom providers with the right baseURL and API key.
- [ ] Click `Refresh` should retrieve a list of available models from the Custom Providers.
- [ ] User can chat with the custom providers
- [ ] Ensure that Custom Providers can be deleted and won't reappear in a new session

In general:
- [ ] Disabled Model Provider should not show up as selectable in chat input of new thread and old thread alike (old threads' chat input should show `Select Model` instead of disabled model)

#### In `Shortcuts`:

Make sure the following shortcut key combo is visible and works:
- [ ] New chat
- [ ] Toggle Sidebar
- [ ] Zoom In
- [ ] Zoom Out
- [ ] Send Message
- [ ] New Line
- [ ] Navigation

#### In `Hardware`:
Ensure that the following section information show up for hardware
- [ ] Operating System 
- [ ] CPU
- [ ] Memory
- [ ] GPU (If the machine has one)
	- [ ] Enabling and Disabling GPUs and ensure that model still run correctly in both mode
	- [ ] Enabling or Disabling GPU should not affect the UI of the application

#### In `MCP Servers`:
- [ ] Ensure that an user can create a MCP server successfully when enter in the correct information
- [ ] Ensure that `Env` value is masked by `*` in the quick view.
- [ ] If an `Env` value is missing, there should be a error pop up.
- [ ] Ensure that deleted MCP server disappear from the `MCP Server` list without any error
- [ ] Ensure that before a MCP is deleted, it will be disable itself first and won't appear on the tool list after deleted.
- [ ] Ensure that when the content of a MCP server is edited, it will be updated and reflected accordingly in the UI and when running it.
- [ ] Toggling enable and disabled of a MCP server work properly
- [ ] A disabled MCP should not appear in the available tool list in chat input
- [ ] An disabled MCP should not be callable even when forced prompt by the model (ensure there is no ghost MCP server)
- [ ] Ensure that enabled MCP server start automatically upon starting of the application
- [ ] An enabled MCP should show functions in the available tool list
- [ ] User can use a model and call different tool from multiple enabled MCP servers in the same thread
- [ ] If `Allow All MCP Tool Permissions` is disabled, in every new thread, before a tool is called, there should be a confirmation dialog pop up to confirm the action.
- [ ] When the user click `Deny`, the tool call will not be executed and return a message indicate so in the tool call result.
- [ ] When the user click `Allow Once` on the pop up, a confirmation dialog will appear again when the tool is called next time.
- [ ] When the user click `Always Allow` on the pop up, the tool will retain permission and won't ask for confirmation again. (this applied at an individual tool level, not at the MCP server level)
- [ ] If `Allow All MCP Tool Permissions` is enabled, in every new thread,  there should not be any confirmation dialog pop up when a tool is called.
- [ ] When the pop-up appear, make sure that the `Tool Parameters` is also shown with detail in the pop-up.a
- [ ] [0.6.9] Go to Enter JSON configuration when created a new MCp => paste the JSON config inside => click `Save` => server works
- [ ] [0.6.9] If individual JSON config format is failed, the MCP server should not be activated
- [ ] [0.6.9] Make sure that MCP server can be used with streamable-http transport => connect to Smithery and test MCP server

#### In `Local API Server`:
- [ ] User can `Start Server` and chat with the default endpoint
	- [ ] User should see the correct model name at `v1/models`
	- [ ] User should be able to chat with it at `v1/chat/completions`
- [ ] `Open Logs` show the correct query log send to the server and return from the server
- [ ] Make sure that changing all the parameter in `Server Configuration` is reflected when `Start Server`
- [ ] [0.6.9] When the startup configuration, the last used model is also automatically start (users does not have to manually start a model before starting the server)
- [ ] [0.6.9] Make sure that you can send an image to a Local API Server and it also works (can set up Local API Server as a Custom Provider in Jan to test)

#### In `HTTPS Proxy`:
- [ ] Model download request goes through proxy endpoint

## C. Hub
- [ ] User can click `Download` to download a model
- [ ] User can cancel a model in the middle of downloading
- [ ] User can add a Hugging Face model detail to the list by pasting a model name / model url into the search bar and press enter
- [ ] Clicking on a listing will open up the model card information within Jan and render the HTML properly
- [ ] Clicking download work on the `Show variants` section
- [ ] Clicking download work inside the Model card HTML
- [ ] [0.6.9] Check that the model recommendation base on user hardware work as expected in the Model Hub

## D. Threads

#### In the left bar:
- [ ] User can delete an old thread, and it won't reappear even when app restart
- [ ] Change the title of the thread should update its last modification date and re-organise its position in the correct chronological order on the left bar.
- [ ] The title of a new thread is the first message from the user.
- [ ] Users can starred / un-starred threads accordingly
- [ ] Starred threads should move to `Favourite` section and other threads should stay in `Recent`
- [ ] Ensure that the search thread feature return accurate result based on thread titles and contents (including from both `Favourite` and `Recent`)
- [ ] `Delete All` should delete only threads in the `Recents` section
- [ ] `Unstar All` should un-star all of the `Favourites` threads and return them to `Recent`

#### In a thread:
- [ ] When `New Chat` is clicked, the assistant is set as the last selected assistant, the model selected is set as the last used model, and the user can immediately chat with the model. 
- [ ] User can conduct multi-turn conversation in a single thread without lost of data (given that `Context Shift` is not enabled)
- [ ] User can change to a different model in the middle of a conversation in a thread and the model work.
- [ ] User can click on `Regenerate` button on a returned message from the model to get a new response base on the previous context.
- [ ] User can change `Assistant` in the middle of a conversation in a thread and the new assistant setting will be applied instead.
- [ ] The chat windows can render and show all the content of a selected threads (including scroll up and down on long threads)
- [ ] Old thread retained their setting as of the last update / usage
	- [ ] Assistant option
	- [ ] Model option (except if the model / model provider has been deleted or disabled)
- [ ] User can send message with different type of text content (e.g text, emoji, ...)
- [ ] When request model to generate a markdown table, the table is correctly formatted as returned from the model.
- [ ] When model generate code, ensure that the code snippets is properly formatted according to the `Interface -> Code Block` setting.
- [ ] Users can edit their old message and and user can regenerate the answer based on the new message
- [ ] User can click `Copy` to copy the model response
- [ ] User can click `Delete` to delete either the user message or the model response.
- [ ] The token speed appear when a response from model is being generated and the final value is show under the response. 
- [ ] Make sure that user when using IME keyboard to type Chinese and Japanese character and they press `Enter`, the `Send` button doesn't trigger automatically after each words.
- [ ] [0.6.9] Attach an image to the chat input and see if you can chat with it using a remote model
- [ ] [0.6.9] Attach an image to the chat input and see if you can chat with it using a local model
- [ ] [0.6.9] Check that you can paste an image to text box from your system clipboard (Copy - Paste)
- [ ] [0.6.9] Make sure that user can favourite a model in the model selection in chat input

## E. Assistants
- [ ] There is always at least one default Assistant which is Jan
- [ ] The default Jan assistant has `stream = True` by default 
- [ ] User can create / edit a new assistant with different parameters and instructions choice.
- [ ] When user delete the default Assistant, the next Assistant in line will be come the default Assistant and apply their setting to new chat accordingly.
- [ ] User can create / edit assistant from within a Chat windows (on the top left)

## F. After checking everything else

In `Settings -> General`:
- [ ] Change the location of the `App Data` to some other path that is not the default path
- [ ] Click on `Reset` button in `Other` to factory reset the app:
	- [ ] All threads deleted
	- [ ] All Assistant deleted except for default Jan Assistant
	- [ ] `App Data` location is reset back to default path
	- [ ] Interface reset
	- [ ] Model Providers information all reset
		- [ ] Llama.cpp setting reset
		- [ ] API keys cleared
		- [ ] All Custom Providers deleted
	- [ ] MCP Servers reset
	- [ ] Local API Server reset
	- [ ] HTTPS Proxy reset
- [ ] After closing the app, all models are unloaded properly
- [ ] Locate to the data folder using the `App Data` path information => delete the folder => reopen the app to check that all the folder is re-created with all the necessary data.
- [ ] Ensure that the uninstallation process removes the app successfully from the system.
## G. New App Installation
- [ ] Clean up by deleting all the left over folder created by Jan
	- [ ] On MacOS
		- [ ] `~/Library/Application Support/Jan`
		- [ ] `~/Library/Caches/jan.ai.app`
	- [ ] On Windows
		- [ ] `C:\Users<Username>\AppData\Roaming\Jan\`
		- [ ] `C:\Users<Username>\AppData\Local\jan.ai.app`
	- [ ] On Linux
		- [ ] `~/.cache/Jan`
		- [ ] `~/.cache/jan.ai.app`
		- [ ] `~/.local/share/Jan`
		- [ ] `~/.local/share/jan.ai.app`
- [ ] Ensure that the fresh install of Jan launch
- [ ] Do some basic check to see that all function still behaved as expected. To be extra careful, you can go through the whole list again. However, it is more advisable to just check to make sure that all the core functionality like `Thread` and `Model Providers` work as intended.

# II. After release
- [ ] Check that the App Updater works and user can update to the latest release without any problem
- [ ] App restarts after the user finished an update
- [ ] Repeat section `A. Initial update / migration Data check` above to verify that update is done correctly on live version

---
title: Installing Jan on Windows
---

# Windows users
## Step 1: Download the Installer
Download the Jan Installer from  [Jan.ai](https://jan.ai/)

Here, you should choose the `Download for  Windows`
![Jan Installer](img/jan-download.PNG)

## Step 2: Proceed the Windows Defender

You would come by the warning of Windows

<!-- ![Accept Jan](img/window-defender.PNG) -->

Choose `Run away` to accept `Jan.ai`.

Wait till the `Jan` finish installation
<!-- ![Setting up](img/set-up.PNG) -->


## Step 3: Download your first model
Click on `Jan` on your desktop to open.

Welcome to `Jan` home page.
Choose `Explore Models`
<!-- ![Explore models](img/explore-model.PNG) -->

You will be bring to the Model catalog.

You can always choose other models and other model versions by click on `Show available Versions`


<!-- ![Jan Installer](img/model-version.PNG) -->

- Note: Please choose the model suit your memory and RAM.

Choose the model with your favor and hit `Download`.

<!-- ![Jan Installer](img/downloading.PNG) -->

## Step 4: Start the model

## Step 5: Start the conversations

That's it. Have fun with LLMs.

> #### Note:
> As Jan is `development mode`, you might get stuck on a broken build.
>
> ##### To reset your installation:
> 1. Delete Jan Application from /Applications
>
> 2. Clear cache: `rm -rf /Users/$(whoami)/Library/Application\ Support/jan-electron`
> OR `rm -rf /Users/$(whoami)/Library/Application\ Support/jan`
> 
> 3. If the above fail please use:
> `ps aux | grep nitro  // There is nitro and nitro_arm_64 or something kill -9 <PID> // kill it 1-by-1 and see if Jan still works`

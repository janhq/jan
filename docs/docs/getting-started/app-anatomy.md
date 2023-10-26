---
sidebar_position: 2
title: Anatomy of an app
---

## Jan Architecture

![Overall architecture](img/architecture-1.drawio.png)

- Jan platform includes the following components:

  - Processes:
    - UI process:
      - This is Electron framework `renderer` component (Web technology equivalent)
      - Jan provides core platform UI that:
        - Allows App to `register()` function blueprint with name and arguments
        - Run `execute()` registered App functions
    - Node process (NodeJS technology equivalent)
      - This is Electron framework `main process` component (NodeJS runtime)
      - Jan provides core platform UI that:
        - Allows App to `register()` function blueprint with name and arguments
        - Run `execute()` registered App functions
  - `@janhq/core` library that exposes Core API for App to reuse. Currently it only supports App `index.ts`

- Vertically, there are `Platform Core` component and `App` component. Each of those includes UI and Node process that work in pair.

##

Platform has 3 events that are broadcast to installed Apps
![Platform events](img/app-anatomy-4.drawio.png)

- onLaunch()
  ![Platform onLaunch()](img/app-anatomy-1.drawio.png)
- onStart()
  ![Platform onStart()](img/app-anatomy-2.drawio.png)
- onDispose()
  ![Platform onDispose()](img/app-anatomy-3.drawio.png)
- At any given time, when there is new App installtion/ unintallation, the Platform restarts and trigger
- When App is being used, here is how the information passes between Platform and Apps
  ![Communication](img/app-anatomy-5.drawio.png)

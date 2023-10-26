---
sidebar_position: 3
title: App Anatomy
---

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

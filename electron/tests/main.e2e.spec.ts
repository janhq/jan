import { _electron as electron } from "playwright";
import { ElectronApplication, Page, expect, test } from "@playwright/test";

import {
  findLatestBuild,
  parseElectronApp,
  stubDialog,
} from "electron-playwright-helpers";

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  process.env.CI = "e2e";

  const latestBuild = findLatestBuild("dist");
  expect(latestBuild).toBeTruthy();

  // parse the packaged Electron app and find paths and other info
  const appInfo = parseElectronApp(latestBuild);
  expect(appInfo).toBeTruthy();
  expect(appInfo.arch).toBeTruthy();
  expect(appInfo.arch).toBe(process.arch);
  expect(appInfo.asar).toBe(true);
  expect(appInfo.executable).toBeTruthy();
  expect(appInfo.main).toBeTruthy();
  expect(appInfo.name).toBe("jan-electron");
  expect(appInfo.packageJson).toBeTruthy();
  expect(appInfo.packageJson.name).toBe("jan-electron");
  expect(appInfo.platform).toBeTruthy();
  expect(appInfo.platform).toBe(process.platform);
  expect(appInfo.resourcesDir).toBeTruthy();

  electronApp = await electron.launch({
    args: [appInfo.main], // main file from package.json
    executablePath: appInfo.executable, // path to the Electron executable
  });
  await stubDialog(electronApp, "showMessageBox", { response: 1 });

  page = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
  await page.close();
});

test("renders the home page", async () => {
  expect(page).toBeDefined();

  // Welcome text is available
  const welcomeText = await page
    .locator(".text-5xl", {
      hasText: "Welcome,let’s download your first model",
    })
    .first()
    .isDisabled();
  expect(welcomeText).toBe(false);
});

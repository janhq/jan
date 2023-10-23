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

test("renders left navigation panel", async () => {
  // Chat History section is available
  const chatSection = await page
    .getByRole("heading")
    .filter({ hasText: "CHAT HISTORY" })
    .first()
    .isDisabled();
  expect(chatSection).toBe(false);

  // Home actions
  const createBotBtn = await page
    .getByRole("button", { name: "Create bot" })
    .first()
    .isEnabled();
  const exploreBtn = await page
    .getByRole("button", { name: "Explore Models" })
    .first()
    .isEnabled();
  const myModelsBtn = await page
    .getByTestId("My Models")
    .first()
    .isEnabled();
  const settingsBtn = await page
    .getByTestId("Settings")
    .first()
    .isEnabled();
  expect(
    [
      createBotBtn,
      exploreBtn,
      myModelsBtn,
      settingsBtn,
    ].filter((e) => !e).length
  ).toBe(0);
});

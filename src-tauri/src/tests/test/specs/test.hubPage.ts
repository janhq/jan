import * as dotenv from "dotenv";
import { IHomePage } from "../../pageObjects/interface/iHomePage";
import { IHubPage } from "../../pageObjects/interface/iHubPage";
import { IChatPage } from "../../pageObjects/interface/iChatPage";
import { HomePage as MacHomePage } from "../../pageObjects/mac/homePage";
import { HubPage as MacHubPage } from "../../pageObjects/mac/hubPage";
import { ChatPage as MacChatPage } from "../../pageObjects/mac/chatPage";
import common from "@data/common.json";

dotenv.config();

let homePage: IHomePage;
let hubPage: IHubPage;
let chatPage: IChatPage;
const models = common.modelsHub;

describe("Verify user can use a model from Hub", () => {
  beforeEach(async () => {
    if (process.env.RUNNING_OS === "macOS") {
      homePage = new MacHomePage(driver);
      hubPage = new MacHubPage(driver);
      chatPage = new MacChatPage(driver);
    }
    await homePage.activateApp(process.env.BUNDLE_ID);
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput);
    await homePage.setWindowBounds();
  });

  it("should be able to search and use a model from hub", async () => {
    const model = models.janNanoGguf;
    await homePage.openHub();
    await hubPage.waitUntilElementIsVisible(hubPage.elements.searchModelsInput);
    await hubPage.searchModels(model);
    await hubPage.verifyModelIsShowing(model);
    await hubPage.selectModel(model);
    await chatPage.verifyChatInputVisible();
  });

  it("should be able to send a message using selected model", async () => {
    await chatPage.sendMessage("Hello");
    await driver.takeScreenshot();
  });
});

import { IBasePage } from "@interface/iBasePage";

export type HomePageElements = {
  newChatButton: string;
  assistantsButton: string;
  welcomeMessage: string;
  getStartedText: string;
  setupLocalModelButton: string;
  setupRemoteProviderButton: string;
  searchInput: string;
  settingsButton: string;
  searchResultTitle: string;
  hubButton: string;
  menuMoreButton: string;
  deleteAllButton: string;
  deleteAllThreadsTitle: string;
  deleteAllThreadsText: string;
  deleteButton: string;
  cancelButton: string;
};

/**
 * Interface for Home Page interactions
 */
export interface IHomePage extends IBasePage {
  elements: HomePageElements;
  /**
   * Opens a new chat
   * @returns Promise that resolves when the new chat is opened
   */
  openNewChat(): Promise<void>;

  /**
   * Opens the assistants page/section
   * @returns Promise that resolves when the assistants page is opened
   */
  openAssistants(): Promise<void>;

  /**
   * Opens the hub page/section
   * @returns Promise that resolves when the hub page is opened
   */
  openHub(): Promise<void>;

  /**
   * Opens the setting page/section
   * @returns Promise that resolves when the setting page is opened
   */
  openSettings(): Promise<void>;

  /**
   * Searches for a specific text in the search input
   * @param searchText The text to search for
   * @returns Promise that resolves when the search is completed
   */
  searchThreads(searchText: string): Promise<void>;

  /**
   * Verifies if the search result title is visible
   * @param resultTitle The title to verify
   * @returns Promise that resolves when the verification is completed
   */
  verifySearchResultTitle(resultTitle: string): Promise<void>;
}

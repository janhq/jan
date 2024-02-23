import { Page } from '@playwright/test'
import { BasePage } from './basePage'
import { CommonActions } from './commonActions'

export class HubPage extends BasePage {
  readonly menuId: string = 'Hub'
  static readonly containerId: string = 'hub-container-test-id'

  constructor(
    public page: Page,
    readonly action: CommonActions
  ) {
    super(page, action, HubPage.containerId)
  }
}

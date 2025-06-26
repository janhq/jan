import { HomePage } from '../../pom/homePage'
const homePage = new HomePage()
describe('Verify Jan Homepage', () => {
  before(async () => {
    await homePage.wait(10000)
    await homePage.waitUntilElementIsVisible(homePage.elements.searchInput)
  })

  it('user should be able to open new chat', async () => {
    await homePage.openNewChat()
    const result = await homePage.isDisplayed(homePage.elements.newChatButton)
    expect(result).toBeTruthy()
  })

  it('user should be able to open assistants', async () => {
    await homePage.openAssistants()
    const result = await homePage.isDisplayed(
      homePage.elements.assistantsButton
    )
    expect(result).toBeTruthy()
  })

  it('user should be able to search threads', async () => {
    await homePage.isDisplayed(homePage.elements.searchInput)
    await homePage.searchThreads('Something to search')
    await homePage.verifySearchResultTitle('No results found')
  })
})

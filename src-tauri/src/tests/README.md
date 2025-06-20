# Automation Test Framework

This project is an automated testing framework for desktop applications built with WebdriverIO and TypeScript. It supports testing on multiple platforms (currently macOS, with Windows support planned) using Tauri and Appium for desktop automation.

## Project Structure

```
automation-test/
├── allure-results/                # Test results for Allure reporting
├── config/                        # All configuration for running.
│   └── wdio.conf.ts               # WebdriverIO configuration
├── core_lib/                      # Libs directory.
│   └── utilities.ts               # Libs utilities include function for general use.
├── junit-results/                 # JUnit XML test results
├── node_modules/                  # Node.js dependencies
├── pageObjects/                   # Page Object Models
│   ├── interface/                 # Base interfaces for page objects
│   │   ├── iBasePage.ts           # Base interface with common methods
│   │   ├── iChatPage.ts           # Chat page interface
│   │   ├── iHomePage.ts           # Home page interface
│   │   └── iHubPage.ts            # Hub page interface
│   ├── mac/                       # macOS implementation of page objects
│   │   ├── basePage.ts            # macOS base page implementation
│   │   ├── chatPage.ts            # macOS chat page implementation
│   │   ├── homePage.ts            # macOS home page implementation
│   │   └── hubPage.ts             # macOS hub page implementation
│   └── windows/                   # (Future) Windows implementations
├── test/                          # Test suite directory
│   └── specs/                     # Test specification files
│       ├── test.homePage.ts       # Home page test cases
│       └── test.hubPage.ts        # Hub page test cases
├── .env                           # setup environment.
├── package.json                   # Project metadata and dependencies
├── README.md                      # Project documentation
└── tsconfig.json                  # TypeScript configuration
```

## Installation Guide

### Prerequisites

- Node.js 14+ and npm
- Rust and Cargo (for Tauri)
- Xcode Command Line Tools (for macOS)

### Setup

1. Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd automation-test
npm install
```

2. Install Appium globally:

```bash
npm install -g appium
```

3. Install the Mac2 driver for Appium:

```bash
appium driver install mac2
```

4. Setup environment variables by creating a `.env` file in the project root:

```bash
# .env file
APP_PATH="/Applications/Jan-nightly.app"
BUNDLE_ID="jan-nightly.ai.app"
RUNNING_OS="macOS"
TEST_FILES="test/specs/test.chatAndThreadPage.ts"
OPENAI=
```

## Running Tests

Run tests using npm:

```bash
npm run test
```

## Using Interfaces for Cross-Platform Testing

### Interface Architecture

This project uses an interface-based architecture to support testing across multiple platforms. The core concept is:

1. Define interfaces for all page objects in `/pageObjects/interface/`
2. Implement platform-specific versions in their respective folders (`/pageObjects/mac/`, `/pageObjects/windows/`)
3. Use dependency injection in tests to instantiate the correct implementation based on the environment

### How It Works

The tests use platform-agnostic interfaces for all page objects:

```typescript
// Test file example
import { IHomePage } from '../../pageObjects/interface/iHomePage'
import { HomePage as MacHomePage } from '../../pageObjects/mac/homePage'
// import { HomePage as WindowsHomePage } from '../../pageObjects/windows/homePage';

let homePage: IHomePage

beforeEach(async () => {
  if (process.env.RUNNING_OS === 'macOS') {
    homePage = new MacHomePage(driver)
  } else if (process.env.RUNNING_OS === 'Windows') {
    // homePage = new WindowsHomePage(driver);
  }
})
```

### Extending for New Platforms

To add support for a new platform (e.g., Windows):

1. Create a new directory for the platform (e.g., `/pageObjects/windows/`)
2. Implement the interfaces for each page object
3. Update the test files to instantiate the new implementations based on environment

Example Windows implementation:

```typescript
// /pageObjects/windows/homePage.ts
import { IHomePage } from '../interface/iHomePage'

export class HomePage extends BasePage implements IHomePage {
  // Windows-specific implementation of the HomePage interface
}
```

This architecture ensures that:

- Test code remains platform-agnostic
- Platform-specific code is isolated in dedicated implementations
- Adding new platforms requires minimal changes to existing test code

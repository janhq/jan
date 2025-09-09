# Jan E2E Tests

End-to-end tests for the Jan application using WebDriverIO and Tauri WebDriver.

**Platform Support**: Linux and Windows only (macOS not supported)

## Installation & Running

### Using Make
```bash
# Install dependencies
make e2e-install

# Build app for testing  
make e2e-build

# Run tests
make e2e-test

# Or all-in-one
make e2e-all
```

### Using Mise
```bash
# Install dependencies
mise run e2e-install

# Build app for testing
mise run e2e-build  

# Run tests
mise run e2e-test

# Or all-in-one
mise run e2e-all
```

## Requirements

### Prerequisites

- Node.js ≥ 20.0.0
- Yarn ≥ 1.22.0
- Make ≥ 3.81
- Rust (for tauri-driver)

### Auto-installed by scripts

- `tauri-driver` (WebDriver for Tauri)
- Platform-specific WebDriver (Edge for Windows, WebKit for Linux)
- Node.js dependencies
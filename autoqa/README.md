# E2E Test Runner with ReportPortal Integration

🚀 An automated end-to-end test runner for Jan application with ReportPortal integration, screen recording, and comprehensive test monitoring.

## Features

- ✅ **Automated Jan App Testing**: Automatically starts/stops Jan application
- 📹 **Screen Recording**: Records test execution for debugging
- 📊 **ReportPortal Integration**: Optional test results upload to ReportPortal
- 🔄 **Turn Monitoring**: Prevents infinite loops with configurable turn limits
- 🎯 **Flexible Configuration**: Command-line arguments and environment variables
- 🖥️ **Cross-platform**: Windows, macOS, and Linux support
- 📁 **Test Discovery**: Automatically scans test files from directory

## Prerequisites

- Python 3.13+
- Jan application installed
- Windows Sandbox (for computer provider)
- Required Python packages (see requirements.txt)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd autoqa
```

2. Install dependencies:

```bash
## For Windows and Linux
pip install -r requirements.txt

## For macOS
pip install -r requirements-mac.txt
```

3. Ensure Jan application is installed in one of the default locations:
   - Windows: `%LOCALAPPDATA%\Programs\jan\Jan.exe`
   - macOS: `~/Applications/Jan.app/Contents/MacOS/Jan`
   - Linux: `jan` (in PATH)

## Quick Start

### Local Development (No ReportPortal)

```bash
# Run all tests in ./tests directory
python main.py

# Run with custom test directory
python main.py --tests-dir "my_tests"

# Run with custom Jan app path
python main.py --jan-app-path "C:/Custom/Path/Jan.exe"
```

### With ReportPortal Integration

```bash
# Enable ReportPortal with token
python main.py --enable-reportportal --rp-token "YOUR_API_TOKEN"

# Full ReportPortal configuration
python main.py \
  --enable-reportportal \
  --rp-endpoint "https://reportportal.example.com" \
  --rp-project "my_project" \
  --rp-token "YOUR_API_TOKEN"
```

## Configuration

### Command Line Arguments

| Argument                | Environment Variable  | Default                         | Description                                       |
| ----------------------- | --------------------- | ------------------------------- | ------------------------------------------------- |
| `--enable-reportportal` | `ENABLE_REPORTPORTAL` | `false`                         | Enable ReportPortal integration                   |
| `--rp-endpoint`         | `RP_ENDPOINT`         | `https://reportportal.menlo.ai` | ReportPortal endpoint URL                         |
| `--rp-project`          | `RP_PROJECT`          | `default_personal`              | ReportPortal project name                         |
| `--rp-token`            | `RP_TOKEN`            | -                               | ReportPortal API token (required when RP enabled) |
| `--jan-app-path`        | `JAN_APP_PATH`        | _auto-detected_                 | Path to Jan application executable                |
| `--jan-process-name`    | `JAN_PROCESS_NAME`    | `Jan.exe`                       | Jan process name for monitoring                   |
| `--model-name`          | `MODEL_NAME`          | `ByteDance-Seed/UI-TARS-1.5-7B` | AI model name                                     |
| `--model-base-url`      | `MODEL_BASE_URL`      | `http://10.200.108.58:1234/v1`  | Model API endpoint                                |
| `--model-provider`      | `MODEL_PROVIDER`      | `oaicompat`                     | Model provider type                               |
| `--model-loop`          | `MODEL_LOOP`          | `uitars`                        | Agent loop type                                   |
| `--max-turns`           | `MAX_TURNS`           | `30`                            | Maximum turns per test                            |
| `--tests-dir`           | `TESTS_DIR`           | `tests`                         | Directory containing test files                   |
| `--delay-between-tests` | `DELAY_BETWEEN_TESTS` | `3`                             | Delay between tests (seconds)                     |

### Environment Variables

Create a `.env` file or set environment variables:

```bash
# ReportPortal Configuration
ENABLE_REPORTPORTAL=true
RP_ENDPOINT=https://reportportal.example.com
RP_PROJECT=my_project
RP_TOKEN=your_secret_token

# Jan Application
JAN_APP_PATH=C:\Custom\Path\Jan.exe
JAN_PROCESS_NAME=Jan.exe

# Model Configuration
MODEL_NAME=gpt-4
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_PROVIDER=openai

# Test Settings
MAX_TURNS=50
TESTS_DIR=e2e_tests
DELAY_BETWEEN_TESTS=5
```

## Test Structure

### Test Files

- Test files should be `.txt` files containing test prompts
- Place test files in the `tests/` directory (or custom directory)
- Support nested directories for organization

Example test file (`tests/basic/login_test.txt`):

```
Test the login functionality of Jan application.
Navigate to login screen, enter valid credentials, and verify successful login.
```

### Directory Structure

```
autoqa/
├── main.py                 # Main test runner
├── utils.py               # Jan app utilities
├── test_runner.py         # Test execution logic
├── screen_recorder.py     # Screen recording functionality
├── reportportal_handler.py # ReportPortal integration
├── tests/                 # Test files directory
│   ├── basic/
│   │   ├── login_test.txt
│   │   └── navigation_test.txt
│   └── advanced/
│       └── complex_workflow.txt
├── recordings/            # Screen recordings (auto-created)
├── trajectories/          # Agent trajectories (auto-created)
└── README.md
```

## Usage Examples

### Basic Usage

```bash
# Run all tests locally
python main.py

# Get help
python main.py --help
```

### Advanced Usage

```bash
# Custom configuration
python main.py \
  --tests-dir "integration_tests" \
  --max-turns 40 \
  --delay-between-tests 10 \
  --model-name "gpt-4"

# Environment + Arguments
ENABLE_REPORTPORTAL=true RP_TOKEN=secret python main.py --max-turns 50

# Different model provider
python main.py \
  --model-provider "openai" \
  --model-name "gpt-4" \
  --model-base-url "https://api.openai.com/v1"
```

### CI/CD Usage

```bash
# GitHub Actions / CI environment
ENABLE_REPORTPORTAL=true \
RP_TOKEN=${{ secrets.RP_TOKEN }} \
MODEL_NAME=production-model \
MAX_TURNS=40 \
python main.py
```

## Output

### Local Development

- **Console logs**: Detailed execution information
- **Screen recordings**: Saved to `recordings/` directory as MP4 files
- **Trajectories**: Agent interaction data in `trajectories/` directory
- **Local results**: Test results logged to console

### ReportPortal Integration

When enabled, results are uploaded to ReportPortal including:

- Test execution status (PASSED/FAILED)
- Screen recordings as attachments
- Detailed turn-by-turn interaction logs
- Error messages and debugging information

## Troubleshooting

### Common Issues

1. **Jan app not found**:

   ```bash
   # Specify custom path
   python main.py --jan-app-path "D:/Apps/Jan/Jan.exe"
   ```

2. **ReportPortal connection failed**:

   - Verify endpoint URL and token
   - Check network connectivity
   - Ensure project exists

3. **Screen recording issues**:

   - Check disk space in `recordings/` directory
   - Verify screen recording permissions

4. **Test timeouts**:
   ```bash
   # Increase turn limit
   python main.py --max-turns 50
   ```

### Debug Mode

Enable detailed logging by modifying the logging level in `main.py`:

```python
logging.basicConfig(level=logging.DEBUG)
```

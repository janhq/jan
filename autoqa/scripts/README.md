# AutoQA Scripts

This directory contains platform-specific scripts used by the AutoQA GitHub Actions workflow. These scripts help maintain a cleaner and more maintainable workflow file by extracting complex inline scripts into separate files.

## Directory Structure

```text
autoqa/scripts/
├── setup_permissions.sh        # Setup executable permissions for all scripts
├── windows_cleanup.ps1          # Windows: Clean existing Jan installations
├── windows_download.ps1         # Windows: Download Jan app installer
├── windows_install.ps1          # Windows: Install Jan app
├── windows_post_cleanup.ps1     # Windows: Post-test cleanup
├── run_tests.ps1               # Windows: Run AutoQA tests
├── ubuntu_cleanup.sh           # Ubuntu: Clean existing Jan installations
├── ubuntu_download.sh          # Ubuntu: Download Jan app (.deb)
├── ubuntu_install.sh           # Ubuntu: Install Jan app
├── ubuntu_post_cleanup.sh      # Ubuntu: Post-test cleanup
├── macos_cleanup.sh            # macOS: Clean existing Jan installations
├── macos_download.sh           # macOS: Download Jan app (.dmg)
├── macos_install.sh            # macOS: Install Jan app
├── macos_post_cleanup.sh       # macOS: Post-test cleanup
├── run_tests.sh                 # Unix: Run AutoQA tests (Ubuntu/macOS)
├── setup-android-env.sh         # macOS: Configure the Android NDK/JDK toolchain, then exec a command
├── README.md                   # This file
```

## Script Functions

### Windows Scripts (.ps1)

- **windows_cleanup.ps1**: Removes existing Jan installations and kills running processes
- **windows_download.ps1**: Downloads Jan installer with priority-based URL selection
- **windows_install.ps1**: Installs Jan app and sets environment variables
- **windows_post_cleanup.ps1**: Comprehensive cleanup after tests including uninstallation
- **run_tests.ps1**: Runs the AutoQA Python tests with proper arguments

### Ubuntu Scripts (.sh)

- **ubuntu_cleanup.sh**: Removes existing Jan installations and kills running processes
- **ubuntu_download.sh**: Downloads Jan .deb package with priority-based URL selection
- **ubuntu_install.sh**: Installs Jan .deb package and sets environment variables
- **ubuntu_post_cleanup.sh**: Comprehensive cleanup after tests including package removal

### macOS Scripts (.sh)

- **macos_cleanup.sh**: Removes existing Jan installations and kills running processes
- **macos_download.sh**: Downloads Jan .dmg package with priority-based URL selection
- **macos_install.sh**: Mounts DMG, extracts .app, and installs to Applications
- **macos_post_cleanup.sh**: Comprehensive cleanup after tests

### Common Scripts

- **setup_permissions.sh**: Automatically sets executable permissions for all shell scripts
- **run_tests.sh**: Platform-agnostic test runner for Unix-based systems (Ubuntu/macOS)
- **setup-android-env.sh**: Configures `JAVA_HOME`, `ANDROID_HOME`/`ANDROID_NDK_ROOT` and the Rust cross-compile links for Android builds, then execs the command it is given. Only useful on macOS with a local Android SDK (`make dev-android` calls it); it is not used by CI.

## Usage in GitHub Actions

These scripts are called from `.github/workflows/autoqa-template.yml`, the reusable
AutoQA workflow. `.github/workflows/autoqa-manual-trigger.yml` calls the template
with `workflow_dispatch` inputs, and `.github/workflows/autoqa-migration.yml` uses
the same scripts for its migration run:

```yaml
# Setup permissions first (Ubuntu/macOS)
- name: Setup script permissions
  run: |
    chmod +x autoqa/scripts/setup_permissions.sh
    ./autoqa/scripts/setup_permissions.sh

# Then use scripts without chmod
- name: Clean existing Jan installations
  run: |
    ./autoqa/scripts/ubuntu_cleanup.sh

# Windows example (no chmod needed)
- name: Clean existing Jan installations
  shell: powershell
  run: |
    .\autoqa\scripts\windows_cleanup.ps1
```

## Benefits

1. **Maintainability**: Complex scripts are in separate files, easier to read and modify
2. **Reusability**: Scripts can be reused across different workflows or locally
3. **Testing**: Scripts can be tested independently
4. **Version Control**: Better diff tracking for script changes
5. **Platform Consistency**: Similar functionality across platforms in separate files

## Development

When modifying these scripts:

1. Test them locally on the respective platforms
2. Ensure proper error handling and exit codes
3. Follow platform-specific best practices
4. Update this README if new scripts are added

## Script Parameters

### Windows Scripts

- Most scripts accept `-IsNightly` parameter to handle nightly vs stable builds
- Download script accepts multiple URL sources with priority ordering

### Unix Scripts

- Most scripts accept positional parameters for nightly flag and URLs
- Scripts use `$1`, `$2`, etc. for parameter access

## Environment Variables

Scripts set these environment variables for subsequent workflow steps:

- `JAN_APP_URL`: The selected Jan app download URL
- `IS_NIGHTLY`: Boolean flag indicating if it's a nightly build
- `JAN_APP_PATH`: Path to the installed Jan executable
- `JAN_PROCESS_NAME`: Name of the Jan process for monitoring

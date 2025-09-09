#!/bin/bash
# Install E2E Test Dependencies for Linux
# This script installs tauri-driver and WebKitWebDriver

set -e

echo "🚀 Installing E2E test dependencies for Linux..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if Cargo is available
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}✗ Cargo not found. Please install Rust first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Cargo is available${NC}"

# Install tauri-driver
echo -e "${YELLOW}Checking tauri-driver...${NC}"
if command -v tauri-driver &> /dev/null; then
    CURRENT_VERSION=$(tauri-driver --version 2>&1)
    echo -e "${CYAN}Current tauri-driver: $CURRENT_VERSION${NC}"
    echo -e "${YELLOW}Updating to latest version...${NC}"
    if cargo install tauri-driver --locked --force; then
        echo -e "${GREEN}✓ tauri-driver updated successfully${NC}"
    else
        echo -e "${RED}✗ Failed to update tauri-driver${NC}"
        exit 1
    fi
else
    echo -e "${CYAN}tauri-driver not found, installing...${NC}"
    if cargo install tauri-driver --locked; then
        echo -e "${GREEN}✓ tauri-driver installed successfully${NC}"
    else
        echo -e "${RED}✗ Failed to install tauri-driver${NC}"
        exit 1
    fi
fi

# Detect Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
else
    echo -e "${YELLOW}! Could not detect Linux distribution${NC}"
    DISTRO="unknown"
fi

echo -e "${YELLOW}Detected distribution: $DISTRO${NC}"

# Install WebKitWebDriver based on distribution (force reinstall/update)
echo -e "${YELLOW}Installing/updating WebKitWebDriver...${NC}"

install_webkit_webdriver() {
    case $DISTRO in
        ubuntu|debian|pop|linuxmint)
            echo -e "${YELLOW}Installing webkit2gtk-driver for Debian/Ubuntu-based system...${NC}"
            if command -v apt &> /dev/null; then
                sudo apt update
                if sudo apt install -y webkit2gtk-driver; then
                    echo -e "${GREEN}✓ webkit2gtk-driver installed successfully${NC}"
                else
                    echo -e "${RED}✗ Failed to install webkit2gtk-driver${NC}"
                    return 1
                fi
            else
                echo -e "${RED}✗ apt not found${NC}"
                return 1
            fi
            ;;
        fedora|centos|rhel|rocky|almalinux)
            echo -e "${YELLOW}Installing webkit2gtk4.1-devel for Red Hat-based system...${NC}"
            if command -v dnf &> /dev/null; then
                if sudo dnf install -y webkit2gtk4.1-devel; then
                    echo -e "${GREEN}✓ webkit2gtk4.1-devel installed successfully${NC}"
                else
                    echo -e "${RED}✗ Failed to install webkit2gtk4.1-devel${NC}"
                    return 1
                fi
            elif command -v yum &> /dev/null; then
                if sudo yum install -y webkit2gtk4.1-devel; then
                    echo -e "${GREEN}✓ webkit2gtk4.1-devel installed successfully${NC}"
                else
                    echo -e "${RED}✗ Failed to install webkit2gtk4.1-devel${NC}"
                    return 1
                fi
            else
                echo -e "${RED}✗ Neither dnf nor yum found${NC}"
                return 1
            fi
            ;;
        arch|manjaro)
            echo -e "${YELLOW}Installing webkit2gtk for Arch-based system...${NC}"
            if command -v pacman &> /dev/null; then
                if sudo pacman -S --noconfirm webkit2gtk; then
                    echo -e "${GREEN}✓ webkit2gtk installed successfully${NC}"
                else
                    echo -e "${RED}✗ Failed to install webkit2gtk${NC}"
                    return 1
                fi
            else
                echo -e "${RED}✗ pacman not found${NC}"
                return 1
            fi
            ;;
        opensuse*|sled|sles)
            echo -e "${YELLOW}Installing webkit2gtk3-devel for openSUSE...${NC}"
            if command -v zypper &> /dev/null; then
                if sudo zypper install -y webkit2gtk3-devel; then
                    echo -e "${GREEN}✓ webkit2gtk3-devel installed successfully${NC}"
                else
                    echo -e "${RED}✗ Failed to install webkit2gtk3-devel${NC}"
                    return 1
                fi
            else
                echo -e "${RED}✗ zypper not found${NC}"
                return 1
            fi
            ;;
        alpine)
            echo -e "${YELLOW}Installing webkit2gtk-dev for Alpine Linux...${NC}"
            if command -v apk &> /dev/null; then
                if sudo apk add webkit2gtk-dev; then
                    echo -e "${GREEN}✓ webkit2gtk-dev installed successfully${NC}"
                else
                    echo -e "${RED}✗ Failed to install webkit2gtk-dev${NC}"
                    return 1
                fi
            else
                echo -e "${RED}✗ apk not found${NC}"
                return 1
            fi
            ;;
        *)
            echo -e "${YELLOW}! Unknown distribution: $DISTRO${NC}"
            echo -e "${YELLOW}Please install WebKitWebDriver manually for your distribution:${NC}"
            echo -e "${CYAN}  - Debian/Ubuntu: apt install webkit2gtk-driver${NC}"
            echo -e "${CYAN}  - Fedora/RHEL: dnf install webkit2gtk4.1-devel${NC}"
            echo -e "${CYAN}  - Arch: pacman -S webkit2gtk${NC}"
            echo -e "${CYAN}  - openSUSE: zypper install webkit2gtk3-devel${NC}"
            echo -e "${CYAN}  - Alpine: apk add webkit2gtk-dev${NC}"
            return 1
            ;;
    esac
}

if ! install_webkit_webdriver; then
    echo -e "${RED}✗ WebKitWebDriver installation failed or not supported for this distribution${NC}"
    echo -e "${YELLOW}You may need to install it manually before running e2e tests${NC}"
    exit 1
fi

# Verify installations
echo ""
echo -e "${YELLOW}Verifying installations...${NC}"

# Check tauri-driver
if command -v tauri-driver &> /dev/null; then
    TAURI_DRIVER_VERSION=$(tauri-driver --version 2>&1)
    echo -e "${GREEN}✓ tauri-driver: $TAURI_DRIVER_VERSION${NC}"
else
    echo -e "${RED}✗ tauri-driver not found in PATH${NC}"
    echo -e "${YELLOW}Make sure ~/.cargo/bin is in your PATH${NC}"
    exit 1
fi

# Check WebKitWebDriver
if command -v WebKitWebDriver &> /dev/null; then
    echo -e "${GREEN}✓ WebKitWebDriver found in PATH${NC}"
elif pkg-config --exists webkit2gtk-4.1 2>/dev/null || pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
    echo -e "${GREEN}✓ WebKit libraries installed (WebKitWebDriver should work)${NC}"
else
    echo -e "${RED}✗ Neither WebKitWebDriver nor webkit2gtk found${NC}"
    echo -e "${YELLOW}This may cause e2e tests to fail${NC}"
fi

# Check webkit2gtk installation
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
    WEBKIT_VERSION=$(pkg-config --modversion webkit2gtk-4.1)
    echo -e "${GREEN}✓ webkit2gtk-4.1: $WEBKIT_VERSION${NC}"
elif pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
    WEBKIT_VERSION=$(pkg-config --modversion webkit2gtk-4.0)
    echo -e "${GREEN}✓ webkit2gtk-4.0: $WEBKIT_VERSION${NC}"
else
    echo -e "${YELLOW}! webkit2gtk not found via pkg-config${NC}"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo -e "${CYAN}Run 'make e2e-build' then 'make e2e-test' to run tests${NC}"
echo -e "${CYAN}Or use mise: 'mise run e2e-build' then 'mise run e2e-test'${NC}"

# Additional PATH information
if [[ ":$PATH:" != *":$HOME/.cargo/bin:"* ]]; then
    echo ""
    echo -e "${YELLOW}Note: Make sure ~/.cargo/bin is in your PATH:${NC}"
    echo -e "${CYAN}echo 'export PATH=\"\$HOME/.cargo/bin:\$PATH\"' >> ~/.profile${NC}"
    echo -e "${CYAN}source ~/.profile${NC}"
    echo -e "${YELLOW}(Or add to ~/.bashrc, ~/.zshrc depending on your shell)${NC}"
fi
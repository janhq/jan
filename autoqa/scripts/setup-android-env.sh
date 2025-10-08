#!/bin/bash

# Android Development Environment Setup for Jan

# Ensure rustup's Rust toolchain is used instead of Homebrew's
export PATH="$HOME/.cargo/bin:$PATH"

# Set JAVA_HOME for Android builds
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"

export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_NDK_ROOT="$HOME/Library/Android/sdk/ndk/29.0.14033849"
export NDK_HOME="$HOME/Library/Android/sdk/ndk/29.0.14033849"

# Add Android tools to PATH
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin

# Set up CC and CXX for Android compilation
export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang"
export CXX_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang++"
export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
export RANLIB_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ranlib"

# Additional environment variables for Rust cross-compilation
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang"

# Only set global CC and AR for Android builds (when IS_ANDROID is set)
if [ "$IS_ANDROID" = "true" ]; then
    export CC="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang"
    export AR="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar"
    echo "Global CC and AR set for Android build"
fi

# Create symlinks for Android tools if they don't exist
mkdir -p ~/.local/bin
if [ ! -f ~/.local/bin/aarch64-linux-android-ranlib ]; then
    ln -sf $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ranlib ~/.local/bin/aarch64-linux-android-ranlib
fi
if [ ! -f ~/.local/bin/aarch64-linux-android-clang ]; then
    ln -sf $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang ~/.local/bin/aarch64-linux-android-clang
fi
if [ ! -f ~/.local/bin/aarch64-linux-android-clang++ ]; then
    ln -sf $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/aarch64-linux-android21-clang++ ~/.local/bin/aarch64-linux-android-clang++
fi

# Fix the broken clang symlinks by ensuring base clang is available
if [ ! -f ~/.local/bin/clang ]; then
    ln -sf $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang ~/.local/bin/clang
fi
if [ ! -f ~/.local/bin/clang++ ]; then
    ln -sf $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/clang++ ~/.local/bin/clang++
fi

# Create symlinks for target-specific ar tools
if [ ! -f ~/.local/bin/aarch64-linux-android-ar ]; then
    ln -sf $NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar ~/.local/bin/aarch64-linux-android-ar
fi
export PATH="$HOME/.local/bin:$PATH"

echo "Android environment configured:"
echo "ANDROID_HOME: $ANDROID_HOME"
echo "ANDROID_NDK_ROOT: $ANDROID_NDK_ROOT"
echo "PATH includes NDK toolchain: $(echo $PATH | grep -o "ndk.*bin" || echo "NOT FOUND")"

# Verify required tools
echo -e "\nChecking required tools:"
which adb && echo "✅ adb found" || echo "❌ adb not found"
which emulator && echo "✅ emulator found" || echo "❌ emulator not found"
which $CC_aarch64_linux_android && echo "✅ Android clang found" || echo "❌ Android clang not found"

# Show available AVDs
echo -e "\nAvailable Android Virtual Devices:"
emulator -list-avds 2>/dev/null || echo "No AVDs found"

# Execute the provided command
if [ "$1" ]; then
    echo -e "\nExecuting: $@"
    exec "$@"
fi
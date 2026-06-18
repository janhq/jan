# Makefile for Atomic Chat Electron App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
	REPORT_PORTAL_LAUNCH_NAME ?= "Atomic Chat App"
REPORT_PORTAL_DESCRIPTION ?= "Atomic Chat App report"

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds core and extensions
install-and-build:
ifeq ($(OS),Windows_NT)
	echo "skip"
else ifeq ($(shell uname -s),Linux)
	chmod +x src-tauri/build-utils/*
endif
	yarn install
	yarn build:tauri:plugin:api
	yarn build:core
	yarn build:extensions

# Install required Rust targets for macOS universal builds
install-rust-targets:
ifeq ($(shell uname -s),Darwin)
	@echo "Detected macOS, installing universal build targets..."
	rustup target add x86_64-apple-darwin
	rustup target add aarch64-apple-darwin
	@echo "Rust targets installed successfully!"
else
	@echo "Not macOS; skipping Rust target installation."
endif

# Install required Rust targets for Android builds
install-android-rust-targets:
	@echo "Checking and installing Android Rust targets..."
	@rustup target list --installed | grep -q "aarch64-linux-android" || rustup target add aarch64-linux-android
	@rustup target list --installed | grep -q "armv7-linux-androideabi" || rustup target add armv7-linux-androideabi
	@rustup target list --installed | grep -q "i686-linux-android" || rustup target add i686-linux-android
	@rustup target list --installed | grep -q "x86_64-linux-android" || rustup target add x86_64-linux-android
	@echo "Android Rust targets ready!"

# Install required Rust targets for iOS builds
install-ios-rust-targets:
	@echo "Checking and installing iOS Rust targets..."
	@rustup target list --installed | grep -q "aarch64-apple-ios" || rustup target add aarch64-apple-ios
	@rustup target list --installed | grep -q "aarch64-apple-ios-sim" || rustup target add aarch64-apple-ios-sim
	@rustup target list --installed | grep -q "x86_64-apple-ios" || rustup target add x86_64-apple-ios
	@echo "iOS Rust targets ready!"

dev: install-and-build
	yarn download:bin
	make download-llamacpp-backend
	make download-llamacpp-upstream-backend
	make build-mlx-server
	make build-foundation-models-server-if-exists
	make build-cli-dev
	yarn dev

# Same as `dev`, but skips (re)installing backends if they are already present.
# Uses the `-if-exists` targets for llamacpp / mlx-server / foundation-models-server.
dev-fast: install-and-build
	yarn download:bin
	make download-llamacpp-backend-if-exists
	make download-llamacpp-upstream-backend-if-exists
	make build-mlx-server-if-exists
	make build-foundation-models-server-if-exists
	make build-cli-dev
	yarn dev

# Dev-режим с форсированным SetupScreen (онбординг) без удаления моделей.
# Флаг FORCE_ONBOARDING прокидывается в vite как compile-time константа.
dev-onboarding: install-and-build
	yarn download:bin
	make download-llamacpp-backend
	make download-llamacpp-upstream-backend
	make build-mlx-server
	make build-foundation-models-server-if-exists
	make build-cli-dev
	FORCE_ONBOARDING=true yarn dev

# ──────────────────────────────────────────────────────────────
# Windows Development
# ──────────────────────────────────────────────────────────────

# One-time setup: installs Rust, nvm-windows, Node.js 20, Python, jq, Yarn
setup-windows:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
else
	@echo "This target is for Windows only. Use 'make dev' instead."
endif

# Full dev workflow for Windows (mirrors CI pipeline)
dev-windows:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1
else
	@echo "This target is for Windows only. Use 'make dev' instead."
endif

# Same as `dev-windows`, but reuses the llama.cpp backend already downloaded
# under src-tauri/resources/llamacpp-backend-upstream (analogue of `dev-fast`
# for macOS). Skips the GitHub release fetch — fast iteration on the currently
# installed backend without re-downloading.
dev-windows-fast:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1 -SkipBackendDownload
else
	@echo "This target is for Windows only. Use 'make dev-fast' instead."
endif

# Dev workflow with CPU-only backend to test runtime GPU auto-download.
# Clears downloaded backends from the Atomic Chat data folder
# (data\llamacpp-upstream\backends), starts with the upstream `win-cpu-x64`
# build, then the llamacpp-upstream extension detects the GPU and downloads
# the optimal backend (CUDA 12.4 / 13.1 / Vulkan) in the background — and
# shows the UI popup.
dev-windows-cpu:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -Command "\
		Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force; \
		Get-Process -Name 'Atomic Chat','atomic-chat' -ErrorAction SilentlyContinue | Stop-Process -Force; \
		Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue | Where-Object { try { $$_.MainModule.FileName -like '*Atomic Chat*' } catch { $$false } } | Stop-Process -Force; \
		Start-Sleep -Seconds 2; \
		$$settingsFile = Join-Path $$env:APPDATA 'chat.atomic.app\settings.json'; \
		$$dataDir = $$null; \
		if (Test-Path $$settingsFile) { \
			$$s = Get-Content $$settingsFile -Raw | ConvertFrom-Json; \
			$$dataDir = $$s.data_folder; \
		}; \
		if (-not $$dataDir) { $$dataDir = Join-Path $$env:APPDATA 'Atomic Chat\data' }; \
		$$backendsDir = Join-Path $$dataDir 'llamacpp-upstream\backends'; \
		if (Test-Path $$backendsDir) { \
			Write-Host ('Clearing downloaded backends from ' + $$backendsDir) -ForegroundColor Yellow; \
			Remove-Item $$backendsDir -Recurse -Force; \
		} else { \
			Write-Host 'No downloaded backends to clear.' -ForegroundColor Gray; \
		}; \
		$$webviewCandidates = @( \
			(Join-Path $$env:LOCALAPPDATA 'chat.atomic.app\EBWebView\Default\Local Storage'), \
			(Join-Path $$env:APPDATA 'chat.atomic.app\EBWebView\Default\Local Storage') \
		); \
		$$wiped = $$false; \
		foreach ($$path in $$webviewCandidates) { \
			if (Test-Path $$path) { \
				Write-Host ('Clearing WebView2 Local Storage from ' + $$path) -ForegroundColor Yellow; \
				Remove-Item $$path -Recurse -Force -ErrorAction SilentlyContinue; \
				if (-not (Test-Path $$path)) { $$wiped = $$true } else { Write-Host ('  WARN: failed to remove ' + $$path + ' (process still locked?)') -ForegroundColor Red } \
			} \
		}; \
		if (-not $$wiped) { Write-Host 'No WebView2 Local Storage was cleared (paths missing or locked).' -ForegroundColor Gray }; \
		$$env:LLAMACPP_BACKEND = 'win-cpu-x64'; \
		Write-Host ''; \
		Write-Host 'Tip: for a full wipe (all data, models, settings, WebView2 cache) run:' -ForegroundColor Cyan; \
		Write-Host '  make clean-windows-all CONFIRM=1' -ForegroundColor Cyan; \
		Write-Host ''; \
		& '$(CURDIR)/scripts/dev-windows.ps1'; \
	"
else
	@echo "This target is for Windows only."
endif

# Full wipe of all Atomic Chat data on Windows — used to simulate a true
# first-launch as if the app had never been installed. Removes the four
# default APPDATA / LOCALAPPDATA directories (see DEVELOP.md → "Where Atomic
# Chat stores data on Windows"). Does NOT touch a custom data_folder if the
# user relocated it via the in-app setting — that is the user's responsibility.
#
# Guarded by CONFIRM=1 so an accidental `make clean-windows-all` only prints
# what would be removed.
clean-windows-all:
ifeq ($(OS),Windows_NT)
ifeq ($(CONFIRM),1)
	powershell -ExecutionPolicy Bypass -Command "\
		Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force; \
		Get-Process -Name 'Atomic Chat','atomic-chat' -ErrorAction SilentlyContinue | Stop-Process -Force; \
		Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue | Where-Object { try { $$_.MainModule.FileName -like '*chat.atomic.app*' -or $$_.MainModule.FileName -like '*Atomic Chat*' } catch { $$false } } | Stop-Process -Force; \
		Start-Sleep -Seconds 2; \
		$$paths = @( \
			(Join-Path $$env:APPDATA 'Atomic Chat'), \
			(Join-Path $$env:APPDATA 'Atomic-Chat'), \
			(Join-Path $$env:APPDATA 'chat.atomic.app'), \
			(Join-Path $$env:LOCALAPPDATA 'chat.atomic.app') \
		); \
		foreach ($$p in $$paths) { \
			if (Test-Path $$p) { \
				Write-Host ('Removing ' + $$p) -ForegroundColor Yellow; \
				Remove-Item $$p -Recurse -Force -ErrorAction SilentlyContinue; \
				if (Test-Path $$p) { Write-Host ('  WARN: failed to fully remove ' + $$p) -ForegroundColor Red } \
			} else { \
				Write-Host ('Not present: ' + $$p) -ForegroundColor Gray; \
			} \
		}; \
		Write-Host 'Atomic Chat: full data wipe done.' -ForegroundColor Green; \
	"
else
	@powershell -NoProfile -ExecutionPolicy Bypass -Command "\
		Write-Host 'DRY RUN. Nothing was deleted.' -ForegroundColor Yellow; \
		Write-Host 'These paths WOULD be removed when re-run with CONFIRM=1:' -ForegroundColor Yellow; \
		$$paths = @( \
			(Join-Path $$env:APPDATA 'Atomic Chat'), \
			(Join-Path $$env:APPDATA 'Atomic-Chat'), \
			(Join-Path $$env:APPDATA 'chat.atomic.app'), \
			(Join-Path $$env:LOCALAPPDATA 'chat.atomic.app') \
		); \
		foreach ($$p in $$paths) { \
			$$exists = if (Test-Path $$p) { '[exists]' } else { '[not present]' }; \
			Write-Host ('  ' + $$p + '  ' + $$exists) -ForegroundColor Gray; \
		}; \
		Write-Host ''; \
		Write-Host 'Run again with CONFIRM=1 to actually delete:' -ForegroundColor Yellow; \
		Write-Host '  make clean-windows-all CONFIRM=1' -ForegroundColor Cyan; \
	"
endif
else
	@echo "This target is for Windows only."
endif

# Web application targets
install-web-app:
	yarn install

dev-web-app: install-web-app
	yarn build:core
	yarn dev:web-app

build-web-app: install-web-app
	yarn build:core
	yarn build:web-app

serve-web-app:
	yarn serve:web-app

build-serve-web-app: build-web-app
	yarn serve:web-app

# Mobile
dev-android: install-and-build install-android-rust-targets
	@echo "Setting up Android development environment..."
	@if [ ! -d "src-tauri/gen/android" ]; then \
		echo "Android app not initialized. Initializing..."; \
		yarn tauri android init; \
	fi
	@echo "Sourcing Android environment setup..."
	@bash autoqa/scripts/setup-android-env.sh echo "Android environment ready"
	@echo "Starting Android development server..."
	yarn dev:android

dev-ios: install-and-build install-ios-rust-targets
	@echo "Setting up iOS development environment..."
ifeq ($(shell uname -s),Darwin)
	@if [ ! -d "src-tauri/gen/ios" ]; then \
		echo "iOS app not initialized. Initializing..."; \
		yarn tauri ios init; \
	fi
	@echo "Checking iOS development requirements..."
	@xcrun --version > /dev/null 2>&1 || (echo "❌ Xcode command line tools not found. Install with: xcode-select --install" && exit 1)
	@xcrun simctl list devices available | grep -q "iPhone\|iPad" || (echo "❌ No iOS simulators found. Install simulators through Xcode." && exit 1)
	@echo "Starting iOS development server..."
	yarn dev:ios
else
	@echo "❌ iOS development is only supported on macOS"
	@exit 1
endif

# Linting
lint: install-and-build
	yarn lint

# Testing
test: lint install-rust-targets
	yarn download:bin
ifeq ($(OS),Windows_NT)
endif
	yarn test
	yarn copy:assets:tauri
	yarn build:icon
	yarn build:mlx-server
	make build-foundation-models-server-if-exists
	make build-cli
	cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
	cargo test --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
	cargo test --manifest-path src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml
	cargo test --manifest-path src-tauri/utils/Cargo.toml

# Download MLX server binary (mlx-vlm fork) from GitHub releases (macOS only)
# Supports GH_TOKEN env var for authenticated GitHub API requests (avoids rate limits in CI)
# Override MLXVLM_TAG to pin a specific release, e.g.:
#   make build-mlx-server MLXVLM_TAG=mlxvlm-macos-arm64-abc1234
MLXVLM_TAG ?=
build-mlx-server:
ifeq ($(shell uname -s),Darwin)
	@mkdir -p src-tauri/resources/bin
	@echo "Downloading MLX server binary (mlx-vlm)..."; \
	if [ -n "$(MLXVLM_TAG)" ]; then \
		TAG="$(MLXVLM_TAG)"; \
		echo "Using pinned release: $$TAG"; \
	else \
		echo "Fetching latest mlx-vlm release..."; \
		API_URL="https://api.github.com/repos/AtomicBot-ai/mlx-vlm/releases?per_page=50"; \
		TMPREL=$$(mktemp /tmp/mlxvlm-releases-XXXXXX.json); \
		_gh_get() { \
			if [ "$$1" = "1" ] && [ -n "$$GH_TOKEN" ]; then \
				curl -sS -H "Authorization: Bearer $$GH_TOKEN" -H "Accept: application/vnd.github+json" -H "User-Agent: atomic-chat-ci" -o "$$2" -w "%{http_code}" "$$3" || echo "000"; \
			else \
				curl -sS -H "Accept: application/vnd.github+json" -H "User-Agent: atomic-chat-ci" -o "$$2" -w "%{http_code}" "$$3" || echo "000"; \
			fi; \
		}; \
		_gh_fetch() { \
			HTTP_CODE=""; \
			for attempt in 1 2 3 4 5; do \
				HTTP_CODE=$$(_gh_get "$$1" "$$2" "$$3"); \
				case "$$HTTP_CODE" in \
					2*) return 0 ;; \
					403|429|5*|000) \
						echo "  GitHub API attempt $$attempt/5 (auth=$$1): HTTP $$HTTP_CODE, retrying in $$((attempt * 2))s..."; \
						sleep $$((attempt * 2)) ;; \
					*) return 1 ;; \
				esac; \
			done; \
			return 1; \
		}; \
		_response_ok() { \
			[ -s "$$1" ] && jq -e 'type == "array" and length > 0' "$$1" >/dev/null 2>&1; \
		}; \
		USE_TOKEN=0; [ -n "$$GH_TOKEN" ] && USE_TOKEN=1; \
		_gh_fetch "$$USE_TOKEN" "$$TMPREL" "$$API_URL" || true; \
		FIRST_CODE="$$HTTP_CODE"; \
		if ! _response_ok "$$TMPREL" && [ "$$USE_TOKEN" = "1" ]; then \
			echo "Token-authenticated request did not yield usable releases (HTTP $$FIRST_CODE); retrying unauthenticated..."; \
			_gh_fetch "0" "$$TMPREL" "$$API_URL" || true; \
		fi; \
		case "$$HTTP_CODE" in \
			2*) ;; \
			*) echo "Error: GitHub API failed (last HTTP $$HTTP_CODE)"; \
			   echo "  body (first 500 bytes):"; head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			   rm -f "$$TMPREL"; exit 1 ;; \
		esac; \
		if [ ! -s "$$TMPREL" ] || ! jq -e 'type == "array"' "$$TMPREL" >/dev/null 2>&1; then \
			echo "Error: GitHub API returned non-array or empty response (HTTP $$HTTP_CODE):"; \
			head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		REL_COUNT=$$(jq 'length' "$$TMPREL"); \
		echo "GitHub API returned $$REL_COUNT release(s)"; \
		TAG=$$(jq -r '[.[] | select(.tag_name | startswith("mlxvlm-macos-arm64"))] | sort_by(.published_at // .created_at) | reverse | .[0].tag_name // empty' "$$TMPREL"); \
		if [ -z "$$TAG" ]; then \
			echo "Error: No mlx-vlm release found matching 'mlxvlm-macos-arm64*'. First 10 tags in response:"; \
			jq -r '.[0:10] | .[].tag_name' "$$TMPREL" || true; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		rm -f "$$TMPREL"; \
	fi; \
	echo "Release: $$TAG"; \
	URL="https://github.com/AtomicBot-ai/mlx-vlm/releases/download/$$TAG/mlxvlm-mlx-server-macos-arm64.tar.gz"; \
	echo "Downloading: $$URL"; \
	curl -fSL "$$URL" -o /tmp/mlxvlm-mlx-server.tar.gz; \
	tar -xzf /tmp/mlxvlm-mlx-server.tar.gz -C src-tauri/resources/bin/; \
	rm -f /tmp/mlxvlm-mlx-server.tar.gz; \
	chmod +x src-tauri/resources/bin/mlx-server; \
	echo "$$TAG" > src-tauri/resources/bin/mlx-server-version.txt; \
	echo "macos-arm64" > src-tauri/resources/bin/mlx-server-backend.txt; \
	echo "MLX server (mlx-vlm) downloaded and extracted successfully ($$TAG)"
	@SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing mlx-server with identity: $$SIGNING_IDENTITY"; \
		codesign --force --options runtime --timestamp --entitlements src-tauri/Entitlements.plist --sign "$$SIGNING_IDENTITY" src-tauri/resources/bin/mlx-server; \
		echo "Code signing completed successfully"; \
	else \
		echo "Warning: No Developer ID Application identity found. Applying ad-hoc signature."; \
		codesign --force --deep --sign - src-tauri/resources/bin/mlx-server; \
	fi
	@mkdir -p src-tauri/target/debug/resources/bin; \
	cp src-tauri/resources/bin/mlx-server src-tauri/target/debug/resources/bin/mlx-server; \
	cp src-tauri/resources/bin/mlx-server-version.txt src-tauri/target/debug/resources/bin/mlx-server-version.txt; \
	cp src-tauri/resources/bin/mlx-server-backend.txt src-tauri/target/debug/resources/bin/mlx-server-backend.txt; \
	echo "Debug copy updated with signed binary"
else
	@echo "Skipping MLX server download (macOS only)"
endif

# Download MLX server if missing, outdated, or a leftover Swift binary.
# Compares local version tag with the latest GitHub release.
build-mlx-server-if-exists:
ifeq ($(shell uname -s),Darwin)
	@if [ ! -f "src-tauri/resources/bin/mlx-server" ] || [ ! -f "src-tauri/resources/bin/mlx-server-version.txt" ]; then \
		echo "MLX server binary or version file missing — downloading..."; \
		make build-mlx-server; \
	else \
		LOCAL_TAG=$$(cat src-tauri/resources/bin/mlx-server-version.txt 2>/dev/null); \
		API_URL="https://api.github.com/repos/AtomicBot-ai/mlx-vlm/releases"; \
		if [ -n "$$GH_TOKEN" ]; then \
			LATEST_TAG=$$(curl -sf -H "Authorization: Bearer $$GH_TOKEN" "$$API_URL" | python3 -c "import sys,json; rs=json.load(sys.stdin); ts=sorted([r for r in rs if r['tag_name'].startswith('mlxvlm-macos-arm64')], key=lambda r: r.get('published_at') or r.get('created_at') or '', reverse=True); print(ts[0]['tag_name'] if ts else '')" 2>/dev/null); \
		else \
			LATEST_TAG=$$(curl -sf "$$API_URL" | python3 -c "import sys,json; rs=json.load(sys.stdin); ts=sorted([r for r in rs if r['tag_name'].startswith('mlxvlm-macos-arm64')], key=lambda r: r.get('published_at') or r.get('created_at') or '', reverse=True); print(ts[0]['tag_name'] if ts else '')" 2>/dev/null); \
		fi; \
		if [ -z "$$LATEST_TAG" ]; then \
			echo "Could not fetch latest release tag — keeping current ($$LOCAL_TAG)"; \
		elif [ "$$LOCAL_TAG" = "$$LATEST_TAG" ]; then \
			echo "MLX server is up-to-date ($$LOCAL_TAG)"; \
		else \
			echo "MLX server outdated: local=$$LOCAL_TAG remote=$$LATEST_TAG — updating..."; \
			make build-mlx-server; \
		fi; \
	fi
else
	@echo "Skipping MLX server build (macOS only)"
endif

# Build Apple Foundation Models server (macOS 26+ only) - always builds
build-foundation-models-server:
ifeq ($(shell uname -s),Darwin)
	@echo "Building Foundation Models server for macOS 26+..."
	cd foundation-models-server && swift build -c release
	@echo "Copying foundation-models-server binary..."
	@cp foundation-models-server/.build/release/foundation-models-server src-tauri/resources/bin/foundation-models-server
	@chmod +x src-tauri/resources/bin/foundation-models-server
	@echo "Foundation Models server built and copied successfully"
	@echo "Checking for code signing identity..."
	@SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing foundation-models-server with identity: $$SIGNING_IDENTITY"; \
		codesign --force --options runtime --timestamp --sign "$$SIGNING_IDENTITY" src-tauri/resources/bin/foundation-models-server; \
		echo "Code signing completed successfully"; \
	else \
		echo "Warning: No Developer ID Application identity found. Skipping code signing."; \
	fi
else
	@echo "Skipping Foundation Models server build (macOS only)"
endif

# Build Foundation Models server only if not already present (for dev)
build-foundation-models-server-if-exists:
ifeq ($(shell uname -s),Darwin)
	@if [ -f "src-tauri/resources/bin/foundation-models-server" ]; then \
		echo "Foundation Models server already exists at src-tauri/resources/bin/foundation-models-server, skipping build..."; \
	else \
		make build-foundation-models-server; \
	fi
else
	@echo "Skipping Foundation Models server build (macOS only)"
endif

# Download llamacpp turboquant backend for bundling
# Supports GH_TOKEN env var for authenticated GitHub API requests (avoids rate limits in CI)
# Override LLAMACPP_TAG to pin a specific release, e.g.:
#   make download-llamacpp-backend LLAMACPP_TAG=turboquant-macos-arm64-7c01058
LLAMACPP_TAG ?=
download-llamacpp-backend:
ifeq ($(shell uname -s),Darwin)
	@mkdir -p src-tauri/resources/llamacpp-backend
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ]; then BACKEND="macos-arm64"; else BACKEND="macos-x64"; fi; \
	echo "Platform: $$BACKEND"; \
	if [ -n "$(LLAMACPP_TAG)" ]; then \
		TAG="$(LLAMACPP_TAG)"; \
		echo "Using pinned release: $$TAG"; \
	else \
		echo "Fetching latest llamacpp turboquant release..."; \
		TMPREL=$$(mktemp /tmp/llamacpp-releases-XXXXXX.json); \
		API_URL="https://api.github.com/repos/AtomicBot-ai/atomic-llama-cpp-turboquant/releases?per_page=50"; \
		_gh_get() { \
			if [ "$$1" = "1" ] && [ -n "$$GH_TOKEN" ]; then \
				curl -sS -H "Authorization: Bearer $$GH_TOKEN" -H "Accept: application/vnd.github+json" -H "User-Agent: atomic-chat-ci" -o "$$2" -w "%{http_code}" "$$3" || echo "000"; \
			else \
				curl -sS -H "Accept: application/vnd.github+json" -H "User-Agent: atomic-chat-ci" -o "$$2" -w "%{http_code}" "$$3" || echo "000"; \
			fi; \
		}; \
		_gh_fetch() { \
			HTTP_CODE=""; \
			for attempt in 1 2 3 4 5; do \
				HTTP_CODE=$$(_gh_get "$$1" "$$2" "$$3"); \
				case "$$HTTP_CODE" in \
					2*) return 0 ;; \
					403|429|5*|000) \
						echo "  GitHub API attempt $$attempt/5 (auth=$$1): HTTP $$HTTP_CODE, retrying in $$((attempt * 2))s..."; \
						sleep $$((attempt * 2)) ;; \
					*) return 1 ;; \
				esac; \
			done; \
			return 1; \
		}; \
		_response_ok() { \
			[ -s "$$1" ] && jq -e 'type == "array" and length > 0' "$$1" >/dev/null 2>&1; \
		}; \
		USE_TOKEN=0; [ -n "$$GH_TOKEN" ] && USE_TOKEN=1; \
		_gh_fetch "$$USE_TOKEN" "$$TMPREL" "$$API_URL" || true; \
		FIRST_CODE="$$HTTP_CODE"; \
		case "$$HTTP_CODE" in \
			2*) \
				if jq -e 'type == "array"' "$$TMPREL" >/dev/null 2>&1; then \
					REL_COUNT=$$(jq 'length' "$$TMPREL"); \
					echo "GitHub API returned $$REL_COUNT release(s) (auth=$$USE_TOKEN)"; \
				else \
					REL_COUNT=-1; \
				fi ;; \
			*) \
				echo "  GitHub API request failed (auth=$$USE_TOKEN, HTTP $$HTTP_CODE)"; \
				REL_COUNT=-1 ;; \
		esac; \
		if ! _response_ok "$$TMPREL" && [ "$$USE_TOKEN" = "1" ]; then \
			echo "Token-authenticated request did not yield usable releases (HTTP $$FIRST_CODE); retrying unauthenticated..."; \
			_gh_fetch "0" "$$TMPREL" "$$API_URL" || true; \
		fi; \
		case "$$HTTP_CODE" in \
			2*) ;; \
			*) echo "Error: GitHub API failed (last HTTP $$HTTP_CODE)"; \
			   echo "  body (first 500 bytes):"; head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			   rm -f "$$TMPREL"; exit 1 ;; \
		esac; \
		if [ ! -s "$$TMPREL" ] || ! jq -e 'type == "array"' "$$TMPREL" >/dev/null 2>&1; then \
			echo "Error: GitHub API returned non-array or empty response (HTTP $$HTTP_CODE):"; \
			head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		REL_COUNT=$$(jq 'length' "$$TMPREL"); \
		echo "Final response: $$REL_COUNT release(s)"; \
		TAG=$$(jq -r --arg b "$$BACKEND" '[.[] | select(.tag_name | startswith("turboquant-" + $$b))][0].tag_name // empty' "$$TMPREL"); \
		if [ -z "$$TAG" ]; then \
			echo "No turboquant release found for $$BACKEND, trying legacy release..."; \
			TAG=$$(jq -r '[.[] | select(.tag_name | startswith("turboquant-") | not)][0].tag_name // empty' "$$TMPREL"); \
		fi; \
		if [ -z "$$TAG" ]; then \
			echo "Error: No matching release found for backend=$$BACKEND. First 10 tags in response:"; \
			jq -r '.[0:10] | .[].tag_name' "$$TMPREL" || true; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		rm -f "$$TMPREL"; \
	fi; \
	echo "Release: $$TAG"; \
	case "$$TAG" in \
		turboquant-*) URL="https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant/releases/download/$$TAG/llama-turboquant-$$BACKEND.tar.gz" ;; \
		*) URL="https://github.com/AtomicBot-ai/atomic-llama-cpp-turboquant/releases/download/$$TAG/llama-$$TAG-bin-$$BACKEND.tar.gz" ;; \
	esac; \
	echo "$$TAG" > src-tauri/resources/llamacpp-backend/version.txt; \
	echo "$$BACKEND" > src-tauri/resources/llamacpp-backend/backend.txt; \
	echo "Downloading: $$URL"; \
	curl -fSL "$$URL" -o /tmp/llamacpp-backend.tar.gz; \
	tar -xzf /tmp/llamacpp-backend.tar.gz -C src-tauri/resources/llamacpp-backend/; \
	rm -f /tmp/llamacpp-backend.tar.gz; \
	echo "Downloaded and extracted llamacpp backend successfully"
	@SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing llamacpp backend binaries..."; \
		for bin in src-tauri/resources/llamacpp-backend/build/bin/*; do \
			if [ -f "$$bin" ] && file "$$bin" | grep -q "Mach-O"; then \
				codesign --force --options runtime --timestamp --entitlements src-tauri/Entitlements.plist --sign "$$SIGNING_IDENTITY" "$$bin"; \
			fi; \
		done; \
		echo "Code signing completed"; \
	else \
		echo "Warning: No Developer ID Application identity found. Skipping code signing."; \
	fi
else ifeq ($(OS),Windows_NT)
	@echo "download-llamacpp-backend is a no-op on Windows."
	@echo "Per ADR 2026-05-22, Windows ships only the upstream llama.cpp"
	@echo "provider; run 'make download-llamacpp-upstream-backend' instead."
else
	@echo "Skipping llamacpp backend download (unsupported platform)"
endif

# Download CPU fallback backend for Windows (pure PowerShell, no bash needed).
# Sources the official upstream ggml-org/llama.cpp release into the upstream
# backend resource dir. The app will auto-detect GPU and download the optimal
# backend (CUDA/Vulkan) at runtime via the llamacpp-upstream extension.
# Per ADR 2026-05-22, Windows ships only `llamacpp-upstream` — this target is
# the canonical CPU bundle source for that pipeline.
download-llamacpp-upstream-backend-win-cpu:
	powershell -NoProfile -Command " \
		$$ErrorActionPreference = 'Stop'; \
		$$dir = 'src-tauri/resources/llamacpp-backend-upstream'; \
		if (Test-Path $$dir) { Remove-Item $$dir -Recurse -Force }; \
		New-Item -ItemType Directory -Path $$dir -Force | Out-Null; \
		Write-Host 'Resolving backend index from atomic-chat-conf manifest (ATO-199)...'; \
		$$headers = @{ 'User-Agent' = 'atomic-chat' }; \
		$$backend = 'win-cpu-x64'; \
		$$manifest = Invoke-RestMethod -Uri 'https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/manifest.json' -Headers $$headers; \
		$$tag = ''; \
		$$want = \"llama-$$($$manifest.tag_name)-bin-$${backend}.zip\"; \
		if ($$manifest.assets | Where-Object { $$_.name -eq $$want }) { $$tag = $$manifest.tag_name }; \
		if (-not $$tag) { throw 'atomic-chat-conf backend manifest does not list the win-cpu-x64 asset (update backends/manifest.json)' }; \
		$$url = \"https://github.com/ggml-org/llama.cpp/releases/download/$$tag/llama-$${tag}-bin-$${backend}.zip\"; \
		[System.IO.File]::WriteAllText(\"$$dir/version.txt\", $$tag); \
		[System.IO.File]::WriteAllText(\"$$dir/backend.txt\", $$backend); \
		Write-Host \"Release: $$tag  Backend: $$backend\"; \
		Write-Host \"Downloading: $$url\"; \
		$$tmp = \"$$env:TEMP\\llamacpp-upstream-backend.zip\"; \
		$$ok = $$false; \
		for ($$i = 1; $$i -le 5; $$i++) { \
			try { Invoke-WebRequest -Uri $$url -OutFile $$tmp -UseBasicParsing; $$ok = $$true; break } \
			catch { Write-Host \"Download attempt $$i/5 failed: $$($$_.Exception.Message); retrying...\"; Start-Sleep -Seconds 3 } \
		}; \
		if (-not $$ok) { throw \"Failed to download $$url after 5 attempts\" }; \
		Expand-Archive -Path $$tmp -DestinationPath $$dir -Force; \
		Remove-Item $$tmp -Force -ErrorAction SilentlyContinue; \
		if (-not (Test-Path \"$$dir/build/bin/llama-server.exe\")) { \
			if (Test-Path \"$$dir/llama-server.exe\") { \
				Write-Host 'Relocating flat-extracted binaries into build/bin/...'; \
				New-Item -ItemType Directory -Path \"$$dir/build/bin\" -Force | Out-Null; \
				Get-ChildItem \"$$dir\" -File | Where-Object { $$_.Name -ne 'version.txt' -and $$_.Name -ne 'backend.txt' } | Move-Item -Destination \"$$dir/build/bin/\"; \
			} \
		}; \
		Write-Host \"CPU backend ($$backend) downloaded successfully. App will auto-download GPU backend at runtime.\"; \
	"

# Backwards-compatible alias. CI scripts and earlier dev recipes that still
# call `download-llamacpp-backend-win-cpu` keep working by delegating to the
# new upstream target. Remove after every consumer has migrated.
download-llamacpp-backend-win-cpu: download-llamacpp-upstream-backend-win-cpu
	@echo "[deprecated] download-llamacpp-backend-win-cpu now delegates to download-llamacpp-upstream-backend-win-cpu."

# Full Windows release build (local, no code signing).
# Mirrors CI pipeline from release.yml: CPU-only backend, NSIS + MSI installers.
# Output: src-tauri/target/release/bundle/nsis/*.exe
build-windows-release:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/build-windows-release.ps1
else
	@echo "This target is for Windows only."
endif

# Download upstream ggml-org/llama.cpp backend for bundling alongside the
# turboquant fork on macOS. We ship BOTH backends in the DMG so users can pick
# the "Llama.cpp" provider (vanilla upstream) or the "llama.cpp" provider
# (TurboQuant fork) at runtime. The upstream binary is NOT a fork — we just
# re-codesign the official release with our Developer ID so it survives
# notarization. See ADR in AGENTS.md §7.
#
# Backend-index source (ATO-199): the Windows and Linux branches resolve the
# release tag + asset names from the static manifest in atomic-chat-conf
# (raw.githubusercontent.com — no per-IP rate limit), mirroring the runtime
# `fetchRemoteBackends()` source. The archive downloads themselves still come
# from the ggml-org CDN (LLAMACPP_DOWNLOAD_BASE). macOS stays on
# api.github.com — its macos-arm64/-x64 assets are not in the manifest
# (macOS is bundle-only at runtime). GH_TOKEN only matters for the macOS
# branch now.
# Override LLAMACPP_UPSTREAM_TAG to pin a specific upstream release, e.g.:
#   make download-llamacpp-upstream-backend LLAMACPP_UPSTREAM_TAG=b9222
LLAMACPP_UPSTREAM_TAG ?=
download-llamacpp-upstream-backend:
ifeq ($(shell uname -s),Darwin)
	@mkdir -p src-tauri/resources/llamacpp-backend-upstream
	@ARCH=$$(uname -m); \
	if [ "$$ARCH" = "arm64" ]; then BACKEND="macos-arm64"; else BACKEND="macos-x64"; fi; \
	echo "Platform: $$BACKEND (upstream)"; \
	if [ -n "$(LLAMACPP_UPSTREAM_TAG)" ]; then \
		TAG="$(LLAMACPP_UPSTREAM_TAG)"; \
		echo "Using pinned upstream release: $$TAG"; \
	else \
		echo "Fetching latest upstream llama.cpp release..."; \
		TMPREL=$$(mktemp /tmp/llamacpp-upstream-XXXXXX.json); \
		API_URL="https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=20"; \
		_gh_get() { \
			if [ "$$1" = "1" ] && [ -n "$$GH_TOKEN" ]; then \
				curl -sS -H "Authorization: Bearer $$GH_TOKEN" -H "Accept: application/vnd.github+json" -H "User-Agent: atomic-chat-ci" -o "$$2" -w "%{http_code}" "$$3" || echo "000"; \
			else \
				curl -sS -H "Accept: application/vnd.github+json" -H "User-Agent: atomic-chat-ci" -o "$$2" -w "%{http_code}" "$$3" || echo "000"; \
			fi; \
		}; \
		_gh_fetch() { \
			HTTP_CODE=""; \
			for attempt in 1 2 3 4 5; do \
				HTTP_CODE=$$(_gh_get "$$1" "$$2" "$$3"); \
				case "$$HTTP_CODE" in \
					2*) return 0 ;; \
					403|429|5*|000) \
						echo "  GitHub API attempt $$attempt/5 (auth=$$1): HTTP $$HTTP_CODE, retrying in $$((attempt * 2))s..."; \
						sleep $$((attempt * 2)) ;; \
					*) return 1 ;; \
				esac; \
			done; \
			return 1; \
		}; \
		_tag_ok() { \
			[ -s "$$1" ] && [ "$$(jq -r 'if type=="array" then length else 0 end' "$$1" 2>/dev/null)" -gt 0 ]; \
		}; \
		USE_TOKEN=0; [ -n "$$GH_TOKEN" ] && USE_TOKEN=1; \
		_gh_fetch "$$USE_TOKEN" "$$TMPREL" "$$API_URL" || true; \
		FIRST_CODE="$$HTTP_CODE"; \
		if ! _tag_ok "$$TMPREL" && [ "$$USE_TOKEN" = "1" ]; then \
			echo "Token-authenticated request did not yield a tag_name (HTTP $$FIRST_CODE); retrying unauthenticated..."; \
			_gh_fetch "0" "$$TMPREL" "$$API_URL" || true; \
		fi; \
		case "$$HTTP_CODE" in \
			2*) ;; \
			*) echo "Error: GitHub API failed (last HTTP $$HTTP_CODE)"; \
			   echo "  body (first 500 bytes):"; head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			   rm -f "$$TMPREL"; exit 1 ;; \
		esac; \
		TAG=$$(jq -r --arg suf "-bin-$$BACKEND.tar.gz" '[ .[] | select((.draft // false)|not) | select((.prerelease // false)|not) | . as $$r | select(($$r.assets // []) | any(.name == ("llama-" + $$r.tag_name + $$suf))) ] | .[0].tag_name // empty' "$$TMPREL"); \
		if [ -z "$$TAG" ] || [ "$$TAG" = "null" ]; then \
			echo "Error: no recent release carries asset llama-<tag>-bin-$$BACKEND.tar.gz (upstream asset upload may be in progress):"; \
			head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		rm -f "$$TMPREL"; \
	fi; \
	URL="https://github.com/ggml-org/llama.cpp/releases/download/$$TAG/llama-$$TAG-bin-$$BACKEND.tar.gz"; \
	echo "$$TAG" > src-tauri/resources/llamacpp-backend-upstream/version.txt; \
	echo "$$BACKEND" > src-tauri/resources/llamacpp-backend-upstream/backend.txt; \
	echo "Release: $$TAG  Backend: $$BACKEND"; \
	echo "Downloading: $$URL"; \
	curl -fSL --retry 5 --retry-delay 3 "$$URL" -o /tmp/llamacpp-upstream-backend.tar.gz; \
	tar -xzf /tmp/llamacpp-upstream-backend.tar.gz -C src-tauri/resources/llamacpp-backend-upstream/; \
	rm -f /tmp/llamacpp-upstream-backend.tar.gz; \
	if [ ! -f "src-tauri/resources/llamacpp-backend-upstream/build/bin/llama-server" ]; then \
		if [ -f "src-tauri/resources/llamacpp-backend-upstream/bin/llama-server" ]; then \
			echo "Relocating bin/ → build/bin/ to match expected layout..."; \
			mkdir -p src-tauri/resources/llamacpp-backend-upstream/build; \
			mv src-tauri/resources/llamacpp-backend-upstream/bin src-tauri/resources/llamacpp-backend-upstream/build/bin; \
		elif [ -f "src-tauri/resources/llamacpp-backend-upstream/llama-server" ]; then \
			echo "Relocating flat layout → build/bin/..."; \
			mkdir -p src-tauri/resources/llamacpp-backend-upstream/build/bin; \
			find src-tauri/resources/llamacpp-backend-upstream -maxdepth 1 -type f \( -name "llama-*" -o -name "*.dylib" -o -name "*.metal" \) -exec mv {} src-tauri/resources/llamacpp-backend-upstream/build/bin/ \;; \
		else \
			NESTED_DIR=$$(find src-tauri/resources/llamacpp-backend-upstream -maxdepth 1 -type d -name 'llama-*' | head -1); \
			if [ -n "$$NESTED_DIR" ] && [ -f "$$NESTED_DIR/llama-server" ]; then \
				echo "Relocating $$NESTED_DIR/ → build/bin/ ..."; \
				mkdir -p src-tauri/resources/llamacpp-backend-upstream/build/bin; \
				find "$$NESTED_DIR" -maxdepth 1 -type f -exec mv {} src-tauri/resources/llamacpp-backend-upstream/build/bin/ \;; \
				find "$$NESTED_DIR" -maxdepth 1 -type l -exec mv {} src-tauri/resources/llamacpp-backend-upstream/build/bin/ \;; \
				rmdir "$$NESTED_DIR" 2>/dev/null || rm -rf "$$NESTED_DIR"; \
			fi; \
		fi; \
	fi; \
	echo "Downloaded and extracted upstream llamacpp backend successfully"
	@SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing upstream llamacpp backend binaries..."; \
		for bin in src-tauri/resources/llamacpp-backend-upstream/build/bin/*; do \
			if [ -f "$$bin" ] && file "$$bin" | grep -q "Mach-O"; then \
				codesign --force --options runtime --timestamp --entitlements src-tauri/Entitlements.plist --sign "$$SIGNING_IDENTITY" "$$bin"; \
			fi; \
		done; \
		echo "Code signing completed"; \
	else \
		echo "Warning: No Developer ID Application identity found. Skipping code signing."; \
	fi
else ifeq ($(OS),Windows_NT)
	@mkdir -p src-tauri/resources/llamacpp-backend-upstream
	@echo "Detecting GPU and selecting best upstream backend for Windows..."; \
	BACKEND=""; \
	if [ -n "$(LLAMACPP_BACKEND)" ]; then \
		BACKEND="$(LLAMACPP_BACKEND)"; \
		echo "Using manually specified backend: $$BACKEND"; \
	else \
		NV_DRIVER=$$(powershell -NoProfile -Command "try { $$g = Get-CimInstance Win32_VideoController -EA Stop | Where-Object { $$_.Name -match 'NVIDIA' } | Select-Object -First 1; if($$g -and $$g.DriverVersion){ $$r = $$g.DriverVersion -replace '\\.','' ; if($$r.Length -ge 5){ $$nv=$$r.Substring($$r.Length-5); $$maj=$$nv.Substring(0,3).TrimStart('0'); $$min=$$nv.Substring(3,2); if(-not $$maj){$$maj='0'}; Write-Output \"$$maj.$$min\" } } } catch {}" 2>/dev/null); \
		HAS_VULKAN=$$(powershell -NoProfile -Command "if(Test-Path \"$$env:SystemRoot\\System32\\vulkan-1.dll\"){'true'}else{'false'}" 2>/dev/null); \
		VRAM_MIB=$$(powershell -NoProfile -Command "try{ $$v=(Get-CimInstance Win32_VideoController -EA Stop | ForEach-Object { $$_.AdapterRAM } | Sort-Object -Descending | Select-Object -First 1); if($$v -gt 0){[math]::Floor($$v/1048576)}else{0} } catch { 0 }" 2>/dev/null); \
		echo "NVIDIA driver: $${NV_DRIVER:-none}  Vulkan: $$HAS_VULKAN  VRAM: $${VRAM_MIB:-0} MiB"; \
		if [ -n "$$NV_DRIVER" ]; then \
			NV_MAJOR=$$(echo "$$NV_DRIVER" | cut -d. -f1); \
			NV_MINOR=$$(echo "$$NV_DRIVER" | cut -d. -f2); \
			NV_VAL=$$((NV_MAJOR * 100 + NV_MINOR)); \
			if [ $$NV_VAL -ge 58115 ]; then \
				BACKEND="win-cuda-13-x64"; \
			elif [ $$NV_VAL -ge 55161 ]; then \
				BACKEND="win-cuda-12-x64"; \
			fi; \
		fi; \
		if [ -z "$$BACKEND" ] && [ "$$HAS_VULKAN" = "true" ] && [ "$${VRAM_MIB:-0}" -ge 6144 ]; then \
			BACKEND="win-vulkan-x64"; \
		fi; \
		if [ -z "$$BACKEND" ]; then \
			BACKEND="win-cpu-x64"; \
		fi; \
		echo "Auto-selected backend: $$BACKEND"; \
	fi; \
	echo "Resolving backend index from atomic-chat-conf manifest (ATO-199)..."; \
	TMPREL=$$(mktemp /tmp/llamacpp-upstream-XXXXXX.json); \
	MANIFEST_URL="https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/manifest.json"; \
	if ! curl -sS --retry 5 --retry-delay 3 -H "User-Agent: atomic-chat-ci" -o "$$TMPREL" "$$MANIFEST_URL"; then \
		echo "Error: failed to fetch backend manifest from $$MANIFEST_URL"; \
		rm -f "$$TMPREL"; exit 1; \
	fi; \
	if ! jq -e '.tag_name' "$$TMPREL" >/dev/null 2>&1; then \
		echo "Error: backend manifest did not parse or lacks tag_name:"; \
		head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
		rm -f "$$TMPREL"; exit 1; \
	fi; \
	if echo "$$BACKEND" | grep -Eq '^win-cuda-[0-9]+-x64$$'; then \
		CUDA_MAJOR=$$(echo "$$BACKEND" | sed -E 's/^win-cuda-([0-9]+)-x64$$/\1/'); \
		RESOLVED=$$(jq -r --arg major "$$CUDA_MAJOR" '. as $$r | { tag: $$r.tag_name, minors: [ ($$r.assets // [])[].name | select(test("-bin-win-cuda-" + $$major + "\\.[0-9]+-x64\\.zip$$")) | capture("-bin-win-cuda-" + $$major + "\\.(?<m>[0-9]+)-x64\\.zip$$") | .m | tonumber ] } | select((.minors | length) > 0) | "\(.tag) win-cuda-\($$major).\(.minors | max)-x64"' "$$TMPREL"); \
		TAG=$$(echo "$$RESOLVED" | cut -d" " -f1); \
		BACKEND=$$(echo "$$RESOLVED" | cut -d" " -f2); \
	else \
		TAG=$$(jq -r --arg suf "-bin-$$BACKEND.zip" '. as $$r | if (($$r.assets // []) | any(.name == ("llama-" + $$r.tag_name + $$suf))) then $$r.tag_name else empty end' "$$TMPREL"); \
	fi; \
	if [ -z "$$TAG" ] || [ "$$TAG" = "null" ] || [ -z "$$BACKEND" ]; then \
		echo "Error: backend manifest does not list an asset for backend $$BACKEND (update atomic-chat-conf/backends/manifest.json):"; \
		head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
		rm -f "$$TMPREL"; exit 1; \
	fi; \
	rm -f "$$TMPREL"; \
	URL="https://github.com/ggml-org/llama.cpp/releases/download/$$TAG/llama-$$TAG-bin-$$BACKEND.zip"; \
	echo "$$TAG" > src-tauri/resources/llamacpp-backend-upstream/version.txt; \
	echo "$$BACKEND" > src-tauri/resources/llamacpp-backend-upstream/backend.txt; \
	echo "Release: $$TAG  Backend: $$BACKEND"; \
	echo "Downloading: $$URL"; \
	curl -fSL --retry 5 --retry-delay 3 "$$URL" -o /tmp/llamacpp-upstream-backend.zip; \
	unzip -o /tmp/llamacpp-upstream-backend.zip -d src-tauri/resources/llamacpp-backend-upstream/; \
	rm -f /tmp/llamacpp-upstream-backend.zip; \
	if [ ! -f "src-tauri/resources/llamacpp-backend-upstream/build/bin/llama-server.exe" ]; then \
		if [ -f "src-tauri/resources/llamacpp-backend-upstream/llama-server.exe" ]; then \
			echo "Relocating flat-extracted binaries into build/bin/..."; \
			mkdir -p src-tauri/resources/llamacpp-backend-upstream/build/bin; \
			mv src-tauri/resources/llamacpp-backend-upstream/*.exe src-tauri/resources/llamacpp-backend-upstream/build/bin/; \
			mv src-tauri/resources/llamacpp-backend-upstream/*.dll src-tauri/resources/llamacpp-backend-upstream/build/bin/ 2>/dev/null || true; \
		fi; \
	fi; \
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/download-llamacpp-cudart-windows.ps1 \
		-BackendDir src-tauri/resources/llamacpp-backend-upstream -Backend "$$BACKEND" -Tag "$$TAG" || \
		echo "Warning: cudart merge failed for $$BACKEND (GPU detection may not work)"; \
	echo "Downloaded and extracted upstream llamacpp backend ($$BACKEND) for Windows successfully"
else ifeq ($(shell uname -s),Linux)
	@mkdir -p src-tauri/resources/llamacpp-backend-upstream
	@# Per 2026-05-28 ADR *Linux ships only `llamacpp-upstream`*: Phase 1
	@# bundles the CPU-only build by default. NVIDIA / AMD / Intel users
	@# get `linux-vulkan-x64` at runtime through the "Find optimal
	@# backend" flow — we deliberately do NOT auto-detect GPU at build
	@# time, since the bundled artefact is meant to be the offline
	@# fallback that works on any host.
	@BACKEND="linux-cpu-x64"; \
	UPSTREAM_INFIX="ubuntu-x64"; \
	echo "Platform: $$BACKEND (upstream / Linux, asset infix: $$UPSTREAM_INFIX)"; \
	if [ -n "$(LLAMACPP_UPSTREAM_TAG)" ]; then \
		TAG="$(LLAMACPP_UPSTREAM_TAG)"; \
		echo "Using pinned upstream release: $$TAG"; \
	else \
		echo "Resolving backend index from atomic-chat-conf manifest (ATO-199)..."; \
		TMPREL=$$(mktemp /tmp/llamacpp-upstream-XXXXXX.json); \
		MANIFEST_URL="https://raw.githubusercontent.com/AtomicBot-ai/atomic-chat-conf/main/backends/manifest.json"; \
		if ! curl -sS --retry 5 --retry-delay 3 -H "User-Agent: atomic-chat-ci" -o "$$TMPREL" "$$MANIFEST_URL"; then \
			echo "Error: failed to fetch backend manifest from $$MANIFEST_URL"; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		if ! jq -e '.tag_name' "$$TMPREL" >/dev/null 2>&1; then \
			echo "Error: backend manifest did not parse or lacks tag_name:"; \
			head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		TAG=$$(jq -r --arg suf "-bin-$$UPSTREAM_INFIX.tar.gz" '. as $$r | if (($$r.assets // []) | any(.name == ("llama-" + $$r.tag_name + $$suf))) then $$r.tag_name else empty end' "$$TMPREL"); \
		if [ -z "$$TAG" ] || [ "$$TAG" = "null" ]; then \
			echo "Error: backend manifest does not list asset llama-<tag>-bin-$$UPSTREAM_INFIX.tar.gz (update atomic-chat-conf/backends/manifest.json):"; \
			head -c 500 "$$TMPREL" 2>/dev/null || true; echo; \
			rm -f "$$TMPREL"; exit 1; \
		fi; \
		rm -f "$$TMPREL"; \
	fi; \
	URL="https://github.com/ggml-org/llama.cpp/releases/download/$$TAG/llama-$$TAG-bin-$$UPSTREAM_INFIX.tar.gz"; \
	echo "$$TAG" > src-tauri/resources/llamacpp-backend-upstream/version.txt; \
	echo "$$BACKEND" > src-tauri/resources/llamacpp-backend-upstream/backend.txt; \
	echo "Release: $$TAG  Backend: $$BACKEND"; \
	echo "Downloading: $$URL"; \
	curl -fSL --retry 5 --retry-delay 3 "$$URL" -o /tmp/llamacpp-upstream-backend.tar.gz; \
	tar -xzf /tmp/llamacpp-upstream-backend.tar.gz -C src-tauri/resources/llamacpp-backend-upstream/; \
	rm -f /tmp/llamacpp-upstream-backend.tar.gz; \
	if [ ! -f "src-tauri/resources/llamacpp-backend-upstream/build/bin/llama-server" ]; then \
		if [ -f "src-tauri/resources/llamacpp-backend-upstream/bin/llama-server" ]; then \
			echo "Relocating bin/ → build/bin/ to match expected layout..."; \
			mkdir -p src-tauri/resources/llamacpp-backend-upstream/build; \
			mv src-tauri/resources/llamacpp-backend-upstream/bin src-tauri/resources/llamacpp-backend-upstream/build/bin; \
		elif [ -f "src-tauri/resources/llamacpp-backend-upstream/llama-server" ]; then \
			echo "Relocating flat layout → build/bin/..."; \
			mkdir -p src-tauri/resources/llamacpp-backend-upstream/build/bin; \
			find src-tauri/resources/llamacpp-backend-upstream -maxdepth 1 -type f \( -name "llama-*" -o -name "*.so" -o -name "*.so.*" \) -exec mv {} src-tauri/resources/llamacpp-backend-upstream/build/bin/ \;; \
		else \
			NESTED_DIR=$$(find src-tauri/resources/llamacpp-backend-upstream -maxdepth 1 -type d -name 'llama-*' -o -name 'build' | head -1); \
			if [ -n "$$NESTED_DIR" ] && [ -f "$$NESTED_DIR/llama-server" ]; then \
				echo "Relocating $$NESTED_DIR/ → build/bin/ ..."; \
				mkdir -p src-tauri/resources/llamacpp-backend-upstream/build/bin; \
				find "$$NESTED_DIR" -maxdepth 1 -type f -exec mv {} src-tauri/resources/llamacpp-backend-upstream/build/bin/ \;; \
				find "$$NESTED_DIR" -maxdepth 1 -type l -exec mv {} src-tauri/resources/llamacpp-backend-upstream/build/bin/ \;; \
				rmdir "$$NESTED_DIR" 2>/dev/null || rm -rf "$$NESTED_DIR"; \
			fi; \
		fi; \
	fi; \
	echo "Downloaded and extracted upstream llamacpp backend ($$BACKEND) for Linux successfully"
else
	@echo "Skipping upstream llamacpp backend download (macOS / Windows / Linux only)"
endif

# Convenience target: explicitly download the Linux CPU-only upstream
# backend. Mirrors `download-llamacpp-upstream-backend-win-cpu`. Useful
# for CI jobs that want to be explicit about the artefact they bundle.
download-llamacpp-upstream-backend-linux-cpu:
	@$(MAKE) download-llamacpp-upstream-backend

# Download upstream llamacpp backend only if not already present (for dev)
download-llamacpp-upstream-backend-if-exists:
ifeq ($(shell uname -s),Darwin)
	@if [ -f "src-tauri/resources/llamacpp-backend-upstream/build/bin/llama-server" ]; then \
		echo "upstream llamacpp backend already exists, skipping download..."; \
	else \
		$(MAKE) download-llamacpp-upstream-backend; \
	fi
else ifeq ($(OS),Windows_NT)
	@if [ -f "src-tauri/resources/llamacpp-backend-upstream/build/bin/llama-server.exe" ]; then \
		echo "upstream llamacpp backend already exists, skipping download..."; \
	else \
		$(MAKE) download-llamacpp-upstream-backend; \
	fi
else ifeq ($(shell uname -s),Linux)
	@if [ -f "src-tauri/resources/llamacpp-backend-upstream/build/bin/llama-server" ]; then \
		echo "upstream llamacpp backend already exists, skipping download..."; \
	else \
		$(MAKE) download-llamacpp-upstream-backend; \
	fi
else
	@echo "Skipping upstream llamacpp backend (macOS / Windows / Linux only)"
endif

# Download llamacpp backend only if not already present (for dev)
download-llamacpp-backend-if-exists:
ifeq ($(shell uname -s),Darwin)
	@if [ -f "src-tauri/resources/llamacpp-backend/build/bin/llama-server" ]; then \
		echo "llamacpp backend already exists, skipping download..."; \
	else \
		$(MAKE) download-llamacpp-backend; \
	fi
else ifeq ($(OS),Windows_NT)
	@echo "download-llamacpp-backend-if-exists is a no-op on Windows."
	@echo "Run download-llamacpp-upstream-backend-if-exists instead (Windows ships only the upstream provider)."
else
	@echo "Skipping llamacpp backend (unsupported platform)"
endif

# Build jan CLI (release, platform-aware) → src-tauri/resources/bin/jan[.exe]
build-cli:
ifeq ($(shell uname -s),Darwin)
	cd src-tauri && cargo build --release --features cli --bin jan-cli --target aarch64-apple-darwin
	cd src-tauri && cargo build --release --features cli --bin jan-cli --target x86_64-apple-darwin
	lipo -create \
		src-tauri/target/aarch64-apple-darwin/release/jan-cli \
		src-tauri/target/x86_64-apple-darwin/release/jan-cli \
		-output src-tauri/resources/bin/jan-cli
	chmod +x src-tauri/resources/bin/jan-cli
	mkdir -p src-tauri/target/universal-apple-darwin/release

	echo "Checking for code signing identity..."; \
	SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing jan-cli with identity: $$SIGNING_IDENTITY"; \
		codesign --force --options runtime --timestamp --sign "$$SIGNING_IDENTITY" src-tauri/resources/bin/jan-cli; \
		echo "Code signing completed successfully"; \
	else \
		echo "Warning: No Developer ID Application identity found. Skipping code signing (notarization will fail)."; \
	fi

	cp src-tauri/resources/bin/jan-cli src-tauri/target/universal-apple-darwin/release/jan-cli
else ifeq ($(OS),Windows_NT)
	cd src-tauri && cargo build --release --features cli --bin jan-cli
	powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'src-tauri/resources/bin' | Out-Null; Copy-Item 'src-tauri/target/release/jan-cli.exe' 'src-tauri/resources/bin/jan-cli.exe' -Force"
else
	cd src-tauri && cargo build --release --features cli --bin jan-cli
	cp src-tauri/target/release/jan-cli src-tauri/resources/bin/jan-cli
endif

# Debug build for local dev (faster, native arch only)
build-cli-dev:
	mkdir -p src-tauri/resources/bin
	cd src-tauri && cargo build --features cli --bin jan-cli
ifeq ($(OS),Windows_NT)
	powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'src-tauri/resources/bin' | Out-Null; Copy-Item 'src-tauri/target/debug/jan-cli.exe' 'src-tauri/resources/bin/jan-cli.exe' -Force"
else
	install -m755 src-tauri/target/debug/jan-cli src-tauri/resources/bin/jan-cli
endif

# Build
build: install-and-build install-rust-targets
	yarn build

# ──────────────────────────────────────────────────────────────
# macOS release build: universal .app + .dmg с версией в VOLNAME
# ──────────────────────────────────────────────────────────────
# Шаги:
#   1. yarn tauri build (universal-apple-darwin, macos-конфиг)
#      — Tauri подписывает и нотаризует .app, создаёт и подписывает .dmg
#   2. scripts/rename-dmg-volume.sh
#      — переименовывает том DMG в "Atomic Chat v<version>"
#      — ломает только подпись DMG-контейнера; .app внутри остаётся нотаризованным
#   3. scripts/notarize-dmg-macos.sh
#      — восстанавливает подпись DMG + нотаризует + стейплит (если заданы APPLE_ID/PASSWORD/TEAM_ID)
#
# Для локальной сборки достаточно `make build-mac`; нотаризация автоматически
# пропустится при отсутствии Apple credentials в окружении.
build-mac:
ifeq ($(shell uname -s),Darwin)
	yarn tauri build --target universal-apple-darwin --config src-tauri/tauri.macos.conf.json
	@DMG=$$(ls -t src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null | head -1); \
	if [ -z "$$DMG" ] || [ ! -f "$$DMG" ]; then \
		echo "Error: DMG not found after tauri build"; \
		exit 1; \
	fi; \
	echo "=== DMG located: $$DMG ==="; \
	bash scripts/rename-dmg-volume.sh "$$DMG"; \
	SIGNING_IDENTITY=$${APPLE_SIGNING_IDENTITY:-$$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 | sed -n 's/.*"\(.*\)".*/\1/p')}; \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		bash scripts/notarize-dmg-macos.sh "$$DMG"; \
	else \
		echo "Warning: no Developer ID Application identity found — skipping DMG re-sign/notarize."; \
		echo "Note: DMG volume was renamed but container signature is broken. Set APPLE_SIGNING_IDENTITY or install cert to fix."; \
	fi
else
	@echo "build-mac is macOS-only"
	@exit 1
endif

clean:
ifeq ($(OS),Windows_NT)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo, .yarn -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json, tsconfig.tsbuildinfo -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./electron/pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/resources"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/target"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\jan\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\jan\extensions\" -Recurse -Force }"
else ifeq ($(shell uname -s),Linux)
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name ".yarn" -type d -exec rm -rf '{}' +
	find . -name "packake-lock.json" -type f -exec rm -rf '{}' +
	find . -name "package-lock.json" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	rm -rf ./src-tauri/resources
	rm -rf ./src-tauri/target
	rm -rf "~/jan/extensions"
	rm -rf "~/.cache/jan*"
	rm -rf "./.cache"
else
	find . -name "node_modules" -type d -prune -exec rm -rfv '{}' +
	find . -name ".next" -type d -exec rm -rfv '{}' +
	find . -name "dist" -type d -exec rm -rfv '{}' +
	find . -name "build" -type d -exec rm -rfv '{}' +
	find . -name "out" -type d -exec rm -rfv '{}' +
	find . -name ".turbo" -type d -exec rm -rfv '{}' +
	find . -name ".yarn" -type d -exec rm -rfv '{}' +
	find . -name "package-lock.json" -type f -exec rm -rfv '{}' +
	rm -rfv ./pre-install/*.tgz
	rm -rfv ./extensions/*/*.tgz
	rm -rfv ./electron/pre-install/*.tgz
	rm -rfv ./src-tauri/resources
	rm -rfv ./src-tauri/target
	rm -rfv ~/jan/extensions
	rm -rfv ~/Library/Caches/jan*
endif

# Makefile for Jan Electron App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Jan App"
REPORT_PORTAL_DESCRIPTION ?= "Jan App report"

# Detect OS
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
else
    DETECTED_OS := $(shell uname -s)
endif

# On Windows make runs recipes through cmd.exe -- unless an sh.exe is on PATH,
# which is every Git Bash and MSYS invocation, CI included. The two share no
# spelling for mkdir or for a one-off environment variable, and the OS alone
# cannot tell them apart, so the shell make picked is what the Windows-only
# recipes have to branch on.
ifeq ($(OS),Windows_NT)
    RECIPE_SHELL_IS_CMD := $(if $(filter sh sh.exe bash bash.exe,$(notdir $(SHELL))),,yes)
else
    RECIPE_SHELL_IS_CMD :=
endif

ifeq ($(RECIPE_SHELL_IS_CMD),yes)
    MKDIR = if not exist "$(1)" mkdir "$(1)"
else
    MKDIR = mkdir -p $(1)
endif

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds core and extensions
install-and-build:
ifeq ($(DETECTED_OS),Windows)
	echo "skip"
else ifeq ($(DETECTED_OS),Linux)
	chmod +x src-tauri/build-utils/*
endif
	yarn install
	yarn build:tauri:plugin:api
	yarn build:core
	yarn build:extensions

# Install required Rust targets for macOS universal builds
install-rust-targets:
ifeq ($(DETECTED_OS),Darwin)
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
	$(MAKE) build-mlx-server-if-exists
	$(MAKE) build-cli-dev
	$(MAKE) build-engine-dev-if-possible
	yarn dev

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
ifeq ($(DETECTED_OS),Darwin)
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
#
# `test` is the full local suite and is unchanged: it still builds the real MLX
# server and CLI binary. `test-ci` runs the same suites without those release
# builds -- neither is a declared Tauri resource or externalBin (bundle.resources
# is only resources/LICENSE) and no test executes them, so in CI they were just
# duplicating what `make build` already does on the release path.
test-prepare: lint
	yarn download:bin
	yarn test
	yarn copy:assets:tauri
	yarn build:icon

test-rust:
	cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
	cargo test --locked --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
	cargo test --locked --manifest-path src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml
	cargo test --locked --manifest-path src-tauri/utils/Cargo.toml

test: test-prepare install-rust-targets
	yarn build:mlx-server
	$(MAKE) build-cli
	$(MAKE) test-rust

# Placeholders for the binaries test-ci no longer builds. Each platform's
# tauri.<os>.conf.json declares these under bundle.resources, and
# generate_context!() fails the build script if a declared path is missing --
# but it only checks existence, and no test executes them. Guarded with -e so
# we never clobber a real local build or churn the cargo:rerun-if-changed
# stamps these paths emit.
#
# The PowerShell arm is for cmd.exe only. CI runs make from a bash step, where
# sh expands `$f`/`$p` to nothing before PowerShell ever sees them; the `-`
# prefix then swallowed the syntax error and the stubs were silently never
# created, so the app's build script failed on a missing resource instead.
stub-resources:
ifeq ($(RECIPE_SHELL_IS_CMD),yes)
	-powershell -Command "New-Item -ItemType Directory -Force -Path src-tauri/resources/bin | Out-Null; foreach ($$f in @('jan-cli.exe','jan-llama-worker.exe','ggml-base.dll')) { $$p = Join-Path 'src-tauri/resources/bin' $$f; if (-not (Test-Path $$p)) { New-Item -ItemType File -Path $$p | Out-Null } }"
else ifeq ($(DETECTED_OS),Windows)
	@mkdir -p src-tauri/resources/bin
	@[ -e src-tauri/resources/bin/jan-cli.exe ] || touch src-tauri/resources/bin/jan-cli.exe
	@[ -e src-tauri/resources/bin/jan-llama-worker.exe ] || touch src-tauri/resources/bin/jan-llama-worker.exe
	@ls src-tauri/resources/bin/ggml*.dll >/dev/null 2>&1 || touch src-tauri/resources/bin/ggml-base.dll
else ifeq ($(DETECTED_OS),Darwin)
	@mkdir -p src-tauri/resources/bin
	@[ -e src-tauri/resources/bin/jan-cli ] || touch src-tauri/resources/bin/jan-cli
	@[ -e src-tauri/resources/bin/mlx-server ] || touch src-tauri/resources/bin/mlx-server
	@[ -e src-tauri/resources/bin/mlx-swift_Cmlx.bundle ] || mkdir -p src-tauri/resources/bin/mlx-swift_Cmlx.bundle
	@[ -e src-tauri/resources/bin/jan-llama-worker ] || touch src-tauri/resources/bin/jan-llama-worker
	@ls src-tauri/resources/bin/libggml*.dylib >/dev/null 2>&1 || touch src-tauri/resources/bin/libggml-base.dylib
else
	@mkdir -p src-tauri/resources/bin
	@[ -e src-tauri/resources/bin/jan-cli ] || touch src-tauri/resources/bin/jan-cli
	@[ -e src-tauri/resources/bin/jan-llama-worker ] || touch src-tauri/resources/bin/jan-llama-worker
	@ls src-tauri/resources/bin/libggml*.so* >/dev/null 2>&1 || touch src-tauri/resources/bin/libggml-base.so
endif

test-ci: test-prepare stub-resources
	$(MAKE) test-rust

# Cheap compile guard for the CLI feature set, covering what test-ci no longer
# builds. `make build` still builds the real binary on every platform.
check-cli:
	cd src-tauri && cargo check --locked --features cli --bin jan-cli

# Build MLX server (macOS Apple Silicon only) - always builds
build-mlx-server:
ifeq ($(DETECTED_OS),Darwin)
	@echo "Building MLX server for Apple Silicon..."
	# mlx-swift's Metal shaders are compiled by the PrepareMetalShaders
	# plugin, which only runs under Xcode -- `swift build` produces a
	# binary with no default.metallib and the app fails at runtime. See
	# https://github.com/ml-explore/mlx-swift README ("SwiftPM (command
	# line) cannot build the Metal shaders").
	cd mlx-server && xcodebuild build -scheme mlx-server -destination 'platform=OS X' -configuration Release OTHER_LDFLAGS="-dead_strip"
	@echo "Finding build products..."
	@DERIVED_DATA=$$(find ~/Library/Developer/Xcode/DerivedData/mlx-server-*/Build/Products/Release -maxdepth 0 2>/dev/null | head -1); \
	if [ -z "$$DERIVED_DATA" ] || [ ! -f "$$DERIVED_DATA/mlx-server" ]; then \
		echo "Error: Could not find xcodebuild products under DerivedData"; \
		exit 1; \
	fi; \
	METALLIB=$$(find "$$DERIVED_DATA/mlx-swift_Cmlx.bundle" -name 'default.metallib' -print -quit 2>/dev/null); \
	if [ -z "$$METALLIB" ]; then \
		echo "Error: default.metallib missing under $$DERIVED_DATA/mlx-swift_Cmlx.bundle -- PrepareMetalShaders did not run"; \
		find "$$DERIVED_DATA/mlx-swift_Cmlx.bundle" -maxdepth 4 2>/dev/null; \
		exit 1; \
	fi; \
	mkdir -p src-tauri/resources/bin; \
	echo "Copying mlx-server from $$DERIVED_DATA..."; \
	cp "$$DERIVED_DATA/mlx-server" src-tauri/resources/bin/mlx-server; \
	rm -rf src-tauri/resources/bin/mlx-swift_Cmlx.bundle; \
	cp -r "$$DERIVED_DATA/mlx-swift_Cmlx.bundle" src-tauri/resources/bin/; \
	chmod +x src-tauri/resources/bin/mlx-server; \
	echo "MLX server built and copied successfully"; \
	echo "Checking for code signing identity..."; \
	SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing mlx-server with identity: $$SIGNING_IDENTITY"; \
		codesign --force --options runtime --timestamp --sign "$$SIGNING_IDENTITY" src-tauri/resources/bin/mlx-server; \
		if ! find src-tauri/resources/bin/mlx-swift_Cmlx.bundle -name 'default.metallib' -print -quit 2>/dev/null | grep -q .; then \
			echo "Error: staged mlx-swift_Cmlx.bundle is missing default.metallib; refusing to sign an empty bundle"; \
			exit 1; \
		fi; \
		echo "Signing mlx-swift_Cmlx.bundle..."; \
		codesign --force --options runtime --timestamp --sign "$$SIGNING_IDENTITY" --deep src-tauri/resources/bin/mlx-swift_Cmlx.bundle; \
		echo "Code signing completed successfully"; \
	else \
		echo "Warning: No Developer ID Application identity found. Skipping code signing (notarization will fail)."; \
	fi
else
	@echo "Skipping MLX server build (macOS only)"
endif

# Build MLX server only if not already present (for dev)
build-mlx-server-if-exists:
ifeq ($(DETECTED_OS),Darwin)
	@if [ -f "src-tauri/resources/bin/mlx-server" ]; then \
		echo "MLX server already exists at src-tauri/resources/bin/mlx-server, skipping build..."; \
	else \
		make build-mlx-server; \
	fi
else
	@echo "Skipping MLX server build (macOS only)"
endif

# Build jan CLI (release, platform-aware) → src-tauri/resources/bin/jan[.exe]
build-cli:
ifeq ($(DETECTED_OS),Darwin)
	cd src-tauri && cargo build --release --features cli --bin jan-cli --target aarch64-apple-darwin
	cd src-tauri && cargo build --release --features cli --bin jan-cli --target x86_64-apple-darwin
	lipo -create \
		src-tauri/target/aarch64-apple-darwin/release/jan-cli \
		src-tauri/target/x86_64-apple-darwin/release/jan-cli \
		-output src-tauri/resources/bin/jan-cli
	chmod +x src-tauri/resources/bin/jan-cli
	$(call MKDIR,'src-tauri/target/universal-apple-darwin/release')

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
else ifeq ($(DETECTED_OS),Windows)
	cd src-tauri && cargo build --release --features cli --bin jan-cli
	cp src-tauri/target/release/jan-cli.exe src-tauri/resources/bin/jan-cli.exe
else
	cd src-tauri && cargo build --release --features cli --bin jan-cli
	cp src-tauri/target/release/jan-cli src-tauri/resources/bin/jan-cli
endif

# ---------------------------------------------------------------------------
# llama.cpp engine worker
#
# JAN_ENGINE_VARIANT picks the GPU backends compiled into the worker. Vulkan is
# in every variant, not just the default: it is the fallback when the CUDA or
# ROCm runtime turns out to be missing or too old on the user's machine, and
# ggml chooses between the registered backends at runtime.
#
# The CPU backend is always multi-versioned (GGML_CPU_ALL_VARIANTS), so every
# variant ships the full set of x86-64/ARM microarchitecture modules and ggml
# scores them at load time. That is what "common CPUs" means here.
#
# The variant is a `-` separated list of backends, so a shipping build names
# every backend it carries and one worker covers the machine it lands on:
#
#   vulkan  (default)  vulkan
#   cuda13             cuda + vulkan   (needs CUDA 13 toolkit on PATH)
#   cuda12             cuda + vulkan   (needs CUDA 12 toolkit on PATH)
#   rocm               hip  + vulkan   (needs ROCm/HIP)
#   cuda13-hip-vulkan  all three       (needs the CUDA and the HIP toolkit)
#
# cuda12 and cuda13 cannot be combined: the CUDA major is whichever nvcc is on
# PATH, one toolkit per configure, and both emit libggml-cuda.so.
#
# CUDA 12 vs 13 is not a cmake flag -- it is whichever nvcc is found, and
# llama.cpp adapts CMAKE_CUDA_ARCHITECTURES to it on its own (ggml-cuda's
# CMakeLists only adds the 50/61/70 virtual archs below CUDA 13). They are still
# separate variants because the resulting binaries cover different GPUs, so
# check-engine-toolchain asserts the toolkit matches the variant name rather
# than letting a cuda13 build ship labelled cuda12.
COMMA := ,
SPACE := $(subst ,, )
JAN_ENGINE_VARIANT ?= vulkan

# Shipping builds pair Vulkan with CUDA/ROCm so the app still offloads when the
# vendor runtime turns out to be missing or too old. That needs the Vulkan SDK,
# which a developer with only a CUDA toolkit has no reason to install, so it can
# be dropped locally. Never drop it for a release: the fallback is the point.
JAN_ENGINE_VULKAN_FALLBACK ?= 1

# Overrides the GPU architectures a CUDA build targets. Empty means upstream's
# own list, which covers discrete desktop/datacenter parts (75/80/86/89/90, plus
# 50/61/70 below CUDA 13) but has NO Jetson entry -- Orin is sm_87 and Xavier
# sm_72. Set it for an ARM/Jetson target, or to trim a build to one known GPU:
#     make build-engine JAN_ENGINE_VARIANT=cuda13 JAN_ENGINE_CUDA_ARCHS=87
#     make build-engine JAN_ENGINE_VARIANT=cuda13 JAN_ENGINE_CUDA_ARCHS=86-real
JAN_ENGINE_CUDA_ARCHS ?=
export JAN_ENGINE_CUDA_ARCHS

# One token to one cargo feature. `engine` alone is the CPU-only worker, and it
# is implied by every other feature, so `cpu` maps to it and the GPU tokens do
# not have to name it.
ENGINE_TOKENS := $(subst -, ,$(JAN_ENGINE_VARIANT))
ENGINE_FEATURE_cpu := engine
ENGINE_FEATURE_vulkan := engine-vulkan
ENGINE_FEATURE_metal := engine-metal
ENGINE_FEATURE_cuda12 := engine-cuda
ENGINE_FEATURE_cuda13 := engine-cuda
ENGINE_FEATURE_hip := engine-hip
ENGINE_FEATURE_rocm := engine-hip

ENGINE_UNKNOWN_TOKENS := $(strip $(foreach t,$(ENGINE_TOKENS),$(if $(ENGINE_FEATURE_$(t)),,$(t))))
ifneq ($(ENGINE_UNKNOWN_TOKENS),)
    $(error Unknown JAN_ENGINE_VARIANT '$(JAN_ENGINE_VARIANT)': no backend named '$(ENGINE_UNKNOWN_TOKENS)'. Tokens are cpu, vulkan, metal, cuda12, cuda13, hip/rocm, joined by '-')
endif
ifneq ($(word 2,$(filter cuda12 cuda13,$(ENGINE_TOKENS))),)
    $(error JAN_ENGINE_VARIANT '$(JAN_ENGINE_VARIANT)' names more than one CUDA major, which one build cannot carry)
endif

# The fallback adds vulkan whenever a vendor runtime is in play and the variant
# did not already ask for it. $(sort) dedupes, so naming vulkan twice is
# harmless and the feature list is deterministic.
ENGINE_VENDOR_FEATURES := $(filter engine-cuda engine-hip,$(foreach t,$(ENGINE_TOKENS),$(ENGINE_FEATURE_$(t))))
ENGINE_FEATURE_LIST := $(sort $(foreach t,$(ENGINE_TOKENS),$(ENGINE_FEATURE_$(t))) \
    $(if $(ENGINE_VENDOR_FEATURES),$(if $(filter 1,$(JAN_ENGINE_VULKAN_FALLBACK)),engine-vulkan,),))
ENGINE_FEATURES := $(subst $(SPACE),$(COMMA),$(ENGINE_FEATURE_LIST))

ENGINE_PLUGIN_DIR := src-tauri/plugins/tauri-plugin-llamacpp
ENGINE_BIN_DIR := src-tauri/resources/bin

# cmake and nvcc output goes here, and is tailed live while cargo runs -- cargo
# captures a build script's output and only shows it on failure, so without this
# a fifteen-minute engine build prints nothing and looks hung. Kept afterwards
# as the artifact to attach to a build report.
ENGINE_BUILD_LOG := $(CURDIR)/src-tauri/target/engine-build.log
export JAN_ENGINE_BUILD_LOG := $(ENGINE_BUILD_LOG)

# Parallelism for the engine build only.
#
# `make -j2` alone does NOT reach cmake: build.rs reads NUM_JOBS, which *cargo*
# sets from its own parallelism, and cargo ignores make's jobserver for that
# purpose -- it defaults to num_cpus. So `make -j2` silently built 8-wide and
# passed cmake -j8. Translating make's own -j into CARGO_BUILD_JOBS makes the
# flag mean what it says.
#
# Scoped to the engine rather than exported globally, because an 8-way nvcc
# build is the memory spike worth limiting; throttling the 1,200-crate app build
# to match would just make everything slower.
#
# JAN_ENGINE_JOBS overrides both, for limiting the engine without touching the
# rest of the tree:
#     make build-engine JAN_ENGINE_VARIANT=cuda13 JAN_ENGINE_JOBS=2
#
# A bare `make -j` (unlimited) yields an empty value and falls through to
# cargo's default, which is the right reading of "no limit".
# Deferred (`=`, not `:=`) on purpose: make puts -j into MAKEFLAGS only when it
# runs a recipe, not while parsing the makefile, so a simple assignment reads an
# empty value and the limit is silently lost -- the exact failure this is meant
# to fix. `--jobserver-auth=...` does not match `-j%` (it starts `--`).
MAKE_J = $(strip $(patsubst -j%,%,$(filter -j%,$(MAKEFLAGS))))
JAN_ENGINE_JOBS ?= $(MAKE_J)
ENGINE_CARGO_JOBS = $(if $(JAN_ENGINE_JOBS),CARGO_BUILD_JOBS=$(JAN_ENGINE_JOBS),)
# cmd.exe has no `VAR=value command` prefix, so the same limit is set with `set`
# there. The Windows recipes still run under sh when one is on PATH, where the
# prefix form is the only one that works.
ENGINE_CARGO_JOBS_WIN = $(if $(RECIPE_SHELL_IS_CMD),$(if $(JAN_ENGINE_JOBS),set CARGO_BUILD_JOBS=$(JAN_ENGINE_JOBS)&&,),$(ENGINE_CARGO_JOBS))

# cargo also finds the jobserver in MAKEFLAGS and tries to join it, but a recipe
# line make did not mark recursive never inherits its file descriptors, so cargo
# warns and falls back on every build. An empty CARGO_MAKEFLAGS takes precedence
# over MAKEFLAGS and reads as "no jobserver", which is the truth here:
# parallelism reaches cargo as CARGO_BUILD_JOBS above, and build.rs sizes
# cmake -j from the NUM_JOBS cargo derives from it.
export CARGO_MAKEFLAGS :=

# Streams the build log while $(1) runs, then stops the tail either way. Unix
# only -- the Windows recipes run cargo straight, so cmake output there arrives
# in cargo's own failure dump rather than live.
# `tail -F` tolerates the file not existing yet; the trap covers a cargo failure
# and a Ctrl-C so no reader is left behind.
define with_engine_log
	@mkdir -p $(dir $(ENGINE_BUILD_LOG))
	@: > $(ENGINE_BUILD_LOG)
	@tail -F -n +1 $(ENGINE_BUILD_LOG) 2>/dev/null | sed 's/^/[engine] /' & \
	tail_pid=$$!; \
	trap 'kill $$tail_pid 2>/dev/null || true' EXIT INT TERM; \
	$(1); \
	rc=$$?; \
	sleep 1; \
	kill $$tail_pid 2>/dev/null || true; \
	exit $$rc
endef

# `make dev` must not require a GPU toolchain: a contributor working on the UI
# has no reason to install the Vulkan SDK or CUDA, so the default variant skips
# rather than blocks.
#
# But a variant asked for *explicitly* is a request, not a default -- silently
# skipping it would leave someone waiting for an engine that was never built.
# `origin` distinguishes the two: `file` means the `?=` default below, anything
# else means the caller named it.
ENGINE_VARIANT_EXPLICIT := $(if $(filter-out file,$(origin JAN_ENGINE_VARIANT)),yes,)

build-engine-dev-if-possible:
ifeq ($(DETECTED_OS),Windows)
	@echo "Building the llama.cpp engine (skipped if the toolchain is incomplete)"
	-$(MAKE) build-engine-dev
else
	@if out=$$($(MAKE) --no-print-directory check-engine-toolchain 2>&1); then \
		$(MAKE) --no-print-directory build-engine-dev; \
	elif [ -n "$(ENGINE_VARIANT_EXPLICIT)" ]; then \
		echo "$$out" >&2; \
		echo "" >&2; \
		echo "You asked for JAN_ENGINE_VARIANT=$(JAN_ENGINE_VARIANT) explicitly, so this is a" >&2; \
		echo "hard failure rather than a skip. Note that PATH changes must be in the" >&2; \
		echo "same shell as make, e.g.:" >&2; \
		echo "    PATH=/usr/local/cuda-13/bin:\$$PATH make dev JAN_ENGINE_VARIANT=$(JAN_ENGINE_VARIANT)$(if $(filter 1,$(JAN_ENGINE_VULKAN_FALLBACK)), JAN_ENGINE_VULKAN_FALLBACK=0,)" >&2; \
		exit 1; \
	else \
		echo "=============================================================="; \
		echo "Skipping the llama.cpp engine -- toolchain incomplete:"; \
		echo "$$out" | sed 's/^/  /'; \
		echo ""; \
		echo "Local models will not run. Cloud providers are unaffected."; \
		echo "To build one, name a variant you have the toolchain for:"; \
		echo "    make build-engine-dev JAN_ENGINE_VARIANT=cpu"; \
		echo "=============================================================="; \
	fi
endif

# The vendored llama.cpp. The pin itself lives in build.rs and is read by
# fetch-engine-source.sh, so there is exactly one source of truth for it.
ENGINE_SRC_DIR := $(ENGINE_PLUGIN_DIR)/vendor/llama.cpp

engine-source:
	bash src-tauri/build-utils/fetch-engine-source.sh

# Drops the vendored clone. A `clean` prerequisite rather than part of its
# recipe so it runs *before* clean's `find . -name build -type d` sweeps the
# tree -- otherwise those walk the whole llama.cpp checkout on the way to
# deleting it.
clean-engine-source:
ifeq ($(DETECTED_OS),Windows)
	-powershell -Command "if (Test-Path '$(ENGINE_SRC_DIR)') { Remove-Item -Recurse -Force '$(ENGINE_SRC_DIR)' }"
else
	rm -rf $(ENGINE_SRC_DIR)
endif

check-engine-toolchain:
	bash src-tauri/build-utils/check-engine-toolchain.sh $(JAN_ENGINE_VARIANT) $(ENGINE_FEATURES)

# Release worker plus the ggml runtime it loads.
build-engine: engine-source check-engine-toolchain
	@echo "Building llama.cpp engine worker (variant: $(JAN_ENGINE_VARIANT), features: $(ENGINE_FEATURES), jobs: $(if $(JAN_ENGINE_JOBS),$(JAN_ENGINE_JOBS),all cores))"
	$(call MKDIR,'$(ENGINE_BIN_DIR)')
ifeq ($(DETECTED_OS),Windows)
	cd $(ENGINE_PLUGIN_DIR) && $(ENGINE_CARGO_JOBS_WIN) cargo build --release --features $(ENGINE_FEATURES) --bin jan-llama-worker
	bash src-tauri/build-utils/stage-engine.sh release
else
	$(call with_engine_log,cd $(ENGINE_PLUGIN_DIR) && $(ENGINE_CARGO_JOBS) cargo build --release --features $(ENGINE_FEATURES) --bin jan-llama-worker)
	bash src-tauri/build-utils/stage-engine.sh release
endif
	bash src-tauri/build-utils/sign-engine.sh

# Debug worker for local dev. Same staging, so `make dev` behaves like a bundle.
build-engine-dev: engine-source check-engine-toolchain
	@echo "Building llama.cpp engine worker (dev, variant: $(JAN_ENGINE_VARIANT), jobs: $(if $(JAN_ENGINE_JOBS),$(JAN_ENGINE_JOBS),all cores))"
	$(call MKDIR,'$(ENGINE_BIN_DIR)')
ifeq ($(DETECTED_OS),Windows)
	cd $(ENGINE_PLUGIN_DIR) && $(ENGINE_CARGO_JOBS_WIN) cargo build --features $(ENGINE_FEATURES) --bin jan-llama-worker
	bash src-tauri/build-utils/stage-engine.sh debug
else
	$(call with_engine_log,cd $(ENGINE_PLUGIN_DIR) && $(ENGINE_CARGO_JOBS) cargo build --features $(ENGINE_FEATURES) --bin jan-llama-worker)
	bash src-tauri/build-utils/stage-engine.sh debug
endif

# Debug build for local dev (faster, native arch only)
build-cli-dev:
	$(call MKDIR,'src-tauri/resources/bin')	
	cd src-tauri && cargo build --features cli --bin jan-cli
ifeq ($(DETECTED_OS),Windows)
	copy src-tauri\target\debug\jan-cli.exe src-tauri\resources\bin\jan-cli.exe
else
	install -m755 src-tauri/target/debug/jan-cli src-tauri/resources/bin/jan-cli
endif

# Build
build: install-and-build install-rust-targets
	$(MAKE) build-engine
	yarn build

clean: clean-engine-source
ifeq ($(DETECTED_OS),Windows)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo, .yarn -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json, tsconfig.tsbuildinfo -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./electron/pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/resources"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/target"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\jan\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\jan\extensions\" -Recurse -Force }"
else ifeq ($(DETECTED_OS),Linux)
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

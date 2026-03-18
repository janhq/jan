TARGET  := wasm32-wasip1
RELEASE := release

.PHONY: all runner tools clean

all: runner tools

# Build js-runner.wasm (QuickJS WASM fallback runtime)
runner:
	cargo build --manifest-path runner/Cargo.toml --target $(TARGET) --$(RELEASE)
	mkdir -p wasm
	cp runner/target/$(TARGET)/$(RELEASE)/js-runner.wasm wasm/js-runner.wasm
	@echo "Built wasm/js-runner.wasm ($$(du -sh wasm/js-runner.wasm | cut -f1))"

# Build all WASM tool binaries and copy to wasm/tools/
tools:
	$(MAKE) -C tools-src

clean:
	cargo clean --manifest-path runner/Cargo.toml
	$(MAKE) -C tools-src clean

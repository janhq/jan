TARGET  := wasm32-wasip1
RELEASE := target/$(TARGET)/release
OUT_DIR := ../wasm/tools

.PHONY: all build install clean

all: build install

build:
	cargo build --target $(TARGET) --release

install: build
	mkdir -p $(OUT_DIR)/web $(OUT_DIR)/http $(OUT_DIR)/code
	cp $(RELEASE)/web_search_tool.wasm  $(OUT_DIR)/web/search.wasm
	cp $(RELEASE)/http_fetch_tool.wasm  $(OUT_DIR)/http/fetch.wasm
	cp $(RELEASE)/code_exec_tool.wasm   $(OUT_DIR)/code/exec.wasm
	@echo "Installed tools to $(OUT_DIR):"
	@ls -lh $(OUT_DIR)/web/*.wasm $(OUT_DIR)/http/*.wasm $(OUT_DIR)/code/*.wasm

clean:
	cargo clean
	rm -rf $(OUT_DIR)/web/search.wasm $(OUT_DIR)/http/fetch.wasm $(OUT_DIR)/code/exec.wasm

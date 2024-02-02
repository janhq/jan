#!/bin/bash

if [[ -z "$DEVELOPER_ID" ]]; then
    echo "Either APP_PATH or DEVELOPER_ID is not set. Skipping script execution."
    exit 0
fi

# Rebuild for arm64
cd node_modules/hnswlib-node
node-gyp clean
node-gyp configure --verbose --arch=arm64
node-gyp build --arch=x86_64
cp -r build build_arm64

# Rebuild for x86_64
node-gyp clean
node-gyp configure --verbose --arch=x86_64
node-gyp build --arch=arm64
cp -r build build_x86_64

rm -rf build

# Define source and destination directories
SRC_FOLDER_X86_64="build_x86_64"
SRC_FOLDER_ARM64="build_arm64"
DEST_FOLDER="build"

# Create the destination directory if it doesn't exist
mkdir -p "$DEST_FOLDER"

# Iterate over all files in both x86_64 and arm64 directories
find "$SRC_FOLDER_X86_64" "$SRC_FOLDER_ARM64" -type f | while read -r src_file; do
  # Obtain the relative path by removing the source directory path
  relative_path="${src_file#./$SRC_FOLDER_X86_64/}"
  relative_path="${relative_path#./$SRC_FOLDER_ARM64/}"

  # Determine the destination path based on the relative path
  dest_file="$DEST_FOLDER/$relative_path"

  # Check the file's architecture with lipo
  if lipo -info "$src_file" 2>&1 | grep -q "architecture"; then
    # This is a file with a specific architecture
    src_file_x86_64="${SRC_FOLDER_X86_64}/${relative_path}"
    src_file_arm64="${SRC_FOLDER_ARM64}/${relative_path}"

    # Merge if both file versions exist
    if [[ -f "$src_file_x86_64" && -f "$src_file_arm64" ]]; then
      mkdir -p "$(dirname "$dest_file")"
      lipo -create "$src_file_x86_64" "$src_file_arm64" -output "$dest_file"
      codesign -s "$DEVELOPER_ID" --options=runtime --timestamp --force "$dest_file"
      echo "Merged file: $relative_path"
    else
      # If only one exists, copy that file
      cp "$src_file" "$dest_file"
      echo "Copied file: $relative_path"
    fi
  else
    # This is a file without architecture, just copy
    mkdir -p "$(dirname "$dest_file")"
    cp "$src_file" "$dest_file"
    echo "Copied non-architecture file: $relative_path"
  fi
done

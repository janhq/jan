#!/bin/bash

if [[ -z "$DEVELOPER_ID" ]]; then
    echo "Either APP_PATH or DEVELOPER_ID is not set. Skipping script execution."
    exit 0
fi

# Rebuild for x86_64
cd node_modules/hnswlib-node
python3 -m pip install distutils
npm install

./node_modules/.bin/node-gyp clean
./node_modules/.bin/node-gyp configure --verbose --arch=x86_64
./node_modules/.bin/node-gyp build --arch=arm64
cp -r build build_x86_64

# Rebuild for arm64
./node_modules/.bin/node-gyp clean
./node_modules/.bin/node-gyp configure --verbose --arch=arm64
./node_modules/.bin/node-gyp build --arch=x86_64
cp -r build build_arm64

# Define source and destination directories
SRC_FOLDER_X86_64="build_x86_64"
SRC_FOLDER_ARM64="build_arm64"
DEST_FOLDER="build"

# Create the destination directory if it does not exist
mkdir -p "$DEST_FOLDER"

# Iterate over all files in the x86_64 source folder
find "$SRC_FOLDER_X86_64" -type f | while read -r src_file_x86_64; do
  # Calculate the relative path correctly by removing the source folder prefix
  relative_path="${src_file_x86_64#$SRC_FOLDER_X86_64/}"

  # Determine the corresponding file in the ARM64 folder and the destination file
  src_file_arm64="$SRC_FOLDER_ARM64/$relative_path"
  dest_file="$DEST_FOLDER/$relative_path"

  # Check if the file is an architecture-specific file
  if lipo -info "$src_file_x86_64" &>/dev/null; then
    # If the file has a specific architecture and exists in both source folders
    if [[ -f "$src_file_arm64" ]]; then
      # Create the destination directory if necessary
      mkdir -p "$(dirname "$dest_file")"
      rm -rf $dest_file
      # Merge files from both architectures into the destination file
      lipo -create "$src_file_x86_64" "$src_file_arm64" -output "$dest_file"
      # Sign the merged file
      codesign -s "$DEVELOPER_ID" --options=runtime --timestamp --force "$dest_file"
      echo "Merged and signed: $relative_path"
    else
      # If only the x86_64 file exists, copy it
      # cp "$src_file_x86_64" "$dest_file"
      echo "Skip: $relative_path"
    fi
  else
    # For non-architecture-specific files, just copy
    mkdir -p "$(dirname "$dest_file")"
    # cp "$src_file_x86_64" "$dest_file"
    echo "Skip non-architecture file: $relative_path"
  fi
done

# Remove the source folders after processing
rm -rf "$SRC_FOLDER_X86_64" "$SRC_FOLDER_ARM64"

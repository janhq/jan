#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <path_to_json_input_file>"
    exit 1
fi

INPUT_JSON_FILE="$1"

# Check if the input file exists
if [ ! -f "$INPUT_JSON_FILE" ]; then
    echo "Input file not found: $INPUT_JSON_FILE"
    exit 1
fi

# Use jq to transform the content
jq '
    .name = "jan-beta" |
    .build.productName = "Jan-beta" |
    .build.appId = "jan-beta.ai.app" |
    .build.protocols[0].name = "Jan-beta" |
    .build.protocols[0].schemes = ["jan-beta"] |
    .build.artifactName = "jan-beta-${os}-${arch}-${version}.${ext}"
' "$INPUT_JSON_FILE" > ./package.json.tmp

cat ./package.json.tmp

rm $INPUT_JSON_FILE
mv ./package.json.tmp $INPUT_JSON_FILE

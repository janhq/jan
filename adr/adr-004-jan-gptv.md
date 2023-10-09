# ADR #004: Jan can see

## Changelog
- Oct 6th 2023: Initial draft

## Authors
- @dotieuthien - Hades

## Status
Proposed

## Context
### Bussiness Context
Jan can now understand images and help you with tasks according to your prompt:

- Use-case 1: Jan is a documents manager (PDF, images), user can add data to Jan DB and ask question on the documents.
- Use-case 2: Jan is a document manager, Jan can understand and categorize all of documents, user can search a document by prompt quickly.
- Use-case 3: Jan have a plugin for personal finance, user can upload all of invoice images, Jan can understand and summarize spending situation, statistical dashboard.

## Decision
- This works as a part in Nitro.
- Binary file can run everywhere

### Flow
![flow](images/adr-004-001.png)

### Eyes
![eyes](images/adr-004-002.png)

## Consequences
- Clear design for UI to interact with Jan, maybe we need user give hint for the image.

## Reference
- https://github.com/lancedb/lancedb
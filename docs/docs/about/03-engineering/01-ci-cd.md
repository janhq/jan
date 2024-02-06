---
title: CI & CD
slug: /engineering/ci-cd
description: Jan is a ChatGPT alternative that runs on your own computer, featuring a local API server.
keywords:
  [
    Jan AI,
    Jan,
    ChatGPT alternative,
    local AI,
    private AI,
    conversational AI,
    no-subscription fee,
    large language model,
    developer relations,
    CI and CD,
  ]
---

## Gitflow

1. **Main Branch:** The `main` branch is the default branch for the repository.

2. **Development Branch:** The `dev` branch is the default branch for ongoing development. All feature branches should be created from and merged back into `dev`.

3. **Feature Branches:** When a feature is complete, open a pull request from the feature branch to `dev` using rebase and squash merge.

4. **Release Cut:** Merge from `dev` to `main` for the release (use merge commits).

5. **Regression/Fix Branch:** If any issue arises in the `main` branch, create a `regression/fix` branch from `main`.

6. **Fixing Issues:** After fixing the issue, open a pull request from the `regression/fix` branch to `main`.

7. **Post-Release Update:** After the release, merge the `main` branch back into the `dev` branch.

For more information about the Release Process, please check the [Phase 4](https://jan.ai/engineering/qa/#phase-4-release-dor) of the QA process.

<br></br>

:::note

- **Nightly Build:** The nightly build is based on the `dev` branch. Only during the release cut, the nightly build switches to the `pre-release` branch.

:::

# Contributing to Jan

First off, thank you for considering contributing to Jan. It's people like you that make Jan such an amazing project. Every contribution, no matter how small, is genuinely appreciated.

This document provides a guide for contributing to the Jan project. Please read it carefully to ensure a smooth and effective contribution process.

## How Can I Contribute?

There are many ways to contribute to Jan, from writing code and documentation to reporting bugs and suggesting new features.

### Reporting Bugs

-   **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/menloresearch/jan/issues).
-   If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/menloresearch/jan/issues/new). Be sure to include a clear title, a detailed description of the bug, and steps to reproduce it.

### Suggesting Enhancements

-   If you have an idea for a new feature or an improvement to an existing one, please [open an issue](https://github.com/menloresearch/jan/issues/new) to discuss it. This allows us to coordinate our efforts and avoid duplicated work.

### Code Contributions

If you're ready to contribute code, please follow the steps below.

## Development Setup

The easiest way to get started with the development environment is to use `make` or `mise`. These tools will handle the installation of all necessary dependencies and run the application in development mode.

### Using Make

1.  Clone the repository:
    ```bash
    git clone https://github.com/menloresearch/jan
    cd jan
    ```
2.  Run the development command:
    ```bash
    make dev
    ```

### Using Mise

1.  Clone the repository:
    ```bash
    git clone https://github.com/menloresearch/jan
    cd jan
    ```
2.  Install `mise` if you don't have it already:
    ```bash
    curl https://mise.run | sh
    ```
3.  Install the project's tools and start the development server:
    ```bash
    mise install
    mise dev
    ```

For more details on the build process, please refer to the `README.md` file.

## Project Structure

Jan is a monorepo that contains several packages. Here's an overview of the most important ones:

-   `core/`: A core TypeScript library that contains the main business logic of the application.
-   `web-app/`: The frontend of the application, built with React and Vite. This is the main user interface that you see when you run Jan.
-   `src-tauri/`: The backend of the application, written in Rust using the Tauri framework. It handles system-level operations, file management, and communication with the web-app.
-   `extensions/`: A collection of extensions that add new features to Jan. Each extension is a separate package.
-   `docs/`: The documentation website for Jan, built with Next.js.
-   `website/`: The public-facing website for Jan, built with Astro.

## Coding Style

To maintain a consistent codebase, we use [Prettier](https://prettier.io/) for code formatting. Please make sure to run Prettier on your code before submitting a pull request. You can format your code by running:

```bash
yarn prettier --write .
```

For Git commit messages, please follow these guidelines:

-   Use the present tense (e.g., "Add feature" not "Added feature").
-   Use a short, descriptive title.
-   Provide a more detailed description in the body of the commit message if necessary.

## Submitting a Pull Request

1.  Fork the repository and create a new branch from `main`.
2.  Make your changes in the new branch.
3.  Ensure that your code lints and that all tests pass.
4.  Commit your changes with a clear and descriptive commit message.
5.  Push your branch to your fork and open a pull request to the `main` branch of the original repository.
6.  In the pull request description, please explain the changes you made and why you made them. If your pull request addresses an existing issue, please link to it.

Thank you for your contribution!

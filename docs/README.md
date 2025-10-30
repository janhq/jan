# Website & Docs

This website is built using [Nextra](https://nextra.site/), a modern static website generator.

### Information Architecture

We try to **keep routes consistent** to maintain SEO.

- **`/guides/`**: Guides on how to use the Jan application. For end users who are directly using Jan.

- **`/developer/`**: Developer docs on how to extend Jan. These pages are about what people can build with our software.

- **`/api-reference/`**: Reference documentation for the Jan API server, written in Swagger/OpenAPI format.

- **`/changelog/`**: A list of changes made to the Jan application with each release.

- **`/blog/`**: A blog for the Jan application.

## How to Contribute

Refer to the [Contributing Guide](https://github.com/janhq/jan/blob/main/CONTRIBUTING.md) for more comprehensive information on how to contribute to the Jan project.

### Pre-requisites and Installation

- [Node.js](https://nodejs.org/en/) (version 20.0.0 or higher)
- [yarn](https://yarnpkg.com/) (version 1.22.0 or higher)

#### Installation

```bash
cd jan/docs
yarn install
yarn dev
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

#### Build

```bash
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Deployment

Using SSH:

```bash
USE_SSH=true yarn deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.

### Preview URL, Pre-release and Publishing Documentation

- When a pull request is created, the preview URL will be automatically commented on the pull request.

- The documentation will then be published to [https://jan.ai/](https://jan.ai/) when the pull request is merged to `main`.

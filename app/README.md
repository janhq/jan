# Jan Web

Jan Web is a Next.js application designed to provide users with the ability to interact with the Language Model (LLM) through chat or generate art using Stable Diffusion. This application runs as a single-page application (SPA) and is encapsulated within a Docker container for easy local deployment.

## Features

- Chat with the Language Model: Engage in interactive conversations with the Language Model. Ask questions, seek information, or simply have a chat.

- Generate Art with Stable Diffusion: Utilize the power of Stable Diffusion to generate unique and captivating pieces of art. Experiment with various parameters to achieve desired results.

## Installation and Usage

### Use as complete suite
For using our complete solution, check [this](https://github.com/janhq/jan)
 
### For interactive development

1. **Clone the Repository:**

   ```
   git clone https://github.com/your-username/jan-web.git
   cd jan-web
   ```

2. **Install dependencies:**

   ```
   yarn
   ```

3. **Run development:**

   ```
   yarn dev
   ```
4. **Regenerate Graphql:**

   ```
   HASURA_ADMIN_TOKEN="[hasura_admin_secret_key]" yarn generate
   ```

5. **Access Jan Web:**

   Open your web browser and navigate to `http://localhost:3000` to access the Jan Web application.

## Configuration

You can customize the endpoint of the Jan Web application through environment file. These options can be found in the `.env` file located in the project's root directory.

```env
// .env

KEYCLOAK_CLIENT_ID=hasura
KEYCLOAK_CLIENT_SECRET=**********
AUTH_ISSUER=http://localhost:8088/realms/hasura
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=my-secret
END_SESSION_URL=http://localhost:8088/realms/hasura/protocol/openid-connect/logout
REFRESH_TOKEN_URL=http://localhost:8088/realms/hasura/protocol/openid-connect/token
HASURA_ADMIN_TOKEN=myadminsecretkey
NEXT_PUBLIC_GRAPHQL_ENGINE_URL=localhost:8080
```

Replace above configuration with your actual infrastructure.

## Dependencies

|Library| Category | Version | Description | 
|--|--|--|--|
| [next](https://nextjs.org/) | Framework | 13.4.10 |
| [typescript](https://www.typescriptlang.org/) | Language | 5.1.6 |
| [tailwindcss](https://tailwindcss.com/) | UI | 3.3.3 |
| [Tailwind UI](https://tailwindui.com/) | UI |  |
| [react-hook-form](https://www.react-hook-form.com/) | UI | ^7.45.4 |
| [@headlessui/react](https://headlessui.com/) | UI | ^1.7.15 |
| [@heroicons/react](https://heroicons.com/) | UI | ^2.0.18 |
| [@tailwindcss/typography](https://tailwindcss.com/docs/typography-plugin) | UI | ^0.5.9 |
| [embla-carousel](https://www.embla-carousel.com/) | UI | ^8.0.0-rc11 |
| [@apollo/client](https://www.apollographql.com/docs/react/) | State management | ^3.8.1 |
| [jotai](https://jotai.org/) | State management | ^2.4.0 |


## Deploy to Netlify
Clone this repository on own GitHub account and deploy to Netlify:

[![Netlify Deploy button](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/janhq/jan-web)

## Deploy to Vercel

Deploy Jan Web on Vercel in one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/janhq/jan-web)


## Contributing

Contributions are welcome! If you find a bug or have suggestions for improvements, feel free to open an issue or submit a pull request on the [GitHub repository](https://github.com/janhq/jan-web/tree/6337306c54e735a4a5c2132dcd1377f21fd76a33).

## License

This project is licensed under the Fair-code License - see the [License](https://faircode.io/#licenses) for more details.

---

Feel free to reach out [Discord](https://jan.ai/discord) if you have any questions or need further assistance. Happy coding with Jan Web and exploring the capabilities of the Language Model and Stable Diffusion! 🚀🎨🤖
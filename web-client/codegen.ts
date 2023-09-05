import type { CodegenConfig } from "@graphql-codegen/cli";
import dotenv from "dotenv";
dotenv.config();

const config: CodegenConfig = {
  overwrite: true,
  schema: {
    "http://localhost:8080/v1/graphql": {
      headers: {
        "x-hasura-admin-secret": process.env.HASURA_ADMIN_TOKEN || "",
      },
    },
  },
  documents: "graphql/**/*.graphql",
  generates: {
    "graphql/generated/": {
      preset: "client",
      plugins: [],
      presetConfig: {
        gqlTagName: "gql",
        fragmentMasking: false,
      },
    },
  },
};

export default config;

"use client";

import {
  ApolloProvider,
  ApolloClient,
  InMemoryCache,
  HttpLink,
  concat,
  split,
} from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { setContext } from "@apollo/client/link/context";
import { createClient } from "graphql-ws";
import { getMainDefinition } from "@apollo/client/utilities";
import { getAccessToken } from "@/_utils/tokenAccessor";
import { ReactNode } from "react";

const authMiddleware = setContext(async (_, { headers }) => {
  const token = await getAccessToken();
  return {
    headers: {
      ...headers,
      ...(token && { authorization: token ? `Bearer ${token}` : "" }),
    },
  };
});

const wsLink =
  typeof window !== "undefined"
    ? new GraphQLWsLink(
        createClient({
          url: `${process.env.NEXT_PUBLIC_GRAPHQL_ENGINE_WEB_SOCKET_URL}`,
          connectionParams: async () => {
            const token = await getAccessToken();
            return {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            };
          },
        })
      )
    : null;
const httpLink = new HttpLink({
  uri: `${process.env.NEXT_PUBLIC_GRAPHQL_ENGINE_URL}`,
});

const link =
  typeof window !== "undefined" && wsLink != null
    ? split(
        ({ query }) => {
          const definition = getMainDefinition(query);
          return (
            definition.kind === "OperationDefinition" &&
            definition.operation === "subscription"
          );
        },
        wsLink,
        httpLink
      )
    : httpLink;

type Props = {
  children: ReactNode;
};

export const ApolloWrapper: React.FC<Props> = ({ children }) => {
  const client = new ApolloClient({
    link: concat(authMiddleware, link),
    cache: new InMemoryCache(),
  });

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
};

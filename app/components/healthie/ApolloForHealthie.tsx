'use client';
import { ApolloClient, ApolloProvider, HttpLink, InMemoryCache, split } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import * as ActionCable from '@rails/actioncable';
import ActionCableLink from 'graphql-ruby-client/subscriptions/ActionCableLink';

const httpLink = new HttpLink({
  uri: 'https://api.gethealthie.com/graphql',
  headers: {
    authorization: `Basic ${process.env.NEXT_PUBLIC_HEALTHIE_TOKEN ?? ''}`,
    authorizationsource: 'API'
  }
});

const cable = ActionCable.createConsumer(
  `wss://ws.gethealthie.com/subscriptions?token=${process.env.NEXT_PUBLIC_HEALTHIE_TOKEN ?? ''}`
);

const wsLink = new ActionCableLink({ cable });

const link = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  httpLink
);

const client = new ApolloClient({
  link,
  cache: new InMemoryCache()
});

export function ApolloForHealthie({ children }: { children: React.ReactNode }) {
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

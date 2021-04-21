import assert from 'assert';
import { Envelop } from '@envelop/types';
import type { Server as SocketServer } from 'ws';
export type SubscriptionsFlag = boolean | 'legacy' | 'all';

export async function CreateSubscriptionsServer(flag: SubscriptionsFlag | undefined) {
  if (!flag) return null;

  const GRAPHQL_TRANSPORT_WS_PROTOCOL = 'graphql-transport-ws';
  const GRAPHQL_WS = 'graphql-ws';

  const oldTransport =
    flag === 'legacy' || flag === 'all'
      ? import('subscriptions-transport-ws/dist/server.js').then(value => {
          return value.default.SubscriptionServer;
        })
      : null;

  const [ws, subscriptionsTransportWs, useGraphQLWSServer] = await Promise.all([
    import('ws').then(v => v.default),
    oldTransport,
    flag === 'all' || flag === true ? import('graphql-ws/lib/use/ws').then(v => v.useServer) : null,
  ]);

  const wsServer: SocketServer | [graphqlWsServer: SocketServer, subWsServer: SocketServer] =
    flag === 'all'
      ? [
          /**
           * graphql-ws
           */
          new ws.Server({
            noServer: true,
          }),
          /**
           * subscriptions-transport-ws
           */
          new ws.Server({
            noServer: true,
          }),
        ]
      : new ws.Server({
          noServer: true,
        });

  return function (getEnveloped: Envelop<unknown>) {
    const { schema, execute, subscribe, contextFactory } = getEnveloped();
    if (flag === true) {
      assert(!Array.isArray(wsServer), 'Received more than 1 single server');
      assert(useGraphQLWSServer, 'useGraphQLWSServer not found');

      const graphqlWsServer = useGraphQLWSServer(
        {
          schema,
          execute,
          subscribe,
          context: ctx => contextFactory(ctx),
        },
        wsServer
      );

      return ['new', wsServer, graphqlWsServer] as const;
    } else if (flag === 'all') {
      assert(subscriptionsTransportWs);
      assert(useGraphQLWSServer);
      assert(Array.isArray(wsServer));

      useGraphQLWSServer(
        {
          schema,
          context: ctx => contextFactory(ctx),
          execute,
          subscribe,
        },
        wsServer[0]
      );

      subscriptionsTransportWs.create(
        {
          schema,
          execute,
          subscribe,
          onConnect() {
            return contextFactory({});
          },
        },
        wsServer[1]
      );

      return [
        'both',
        (protocol: string | string[] | undefined) => {
          const protocols = Array.isArray(protocol) ? protocol : protocol?.split(',').map(p => p.trim());

          return protocols?.includes(GRAPHQL_WS) && !protocols.includes(GRAPHQL_TRANSPORT_WS_PROTOCOL)
            ? wsServer[1]
            : wsServer[0];
        },
      ] as const;
    }

    assert(subscriptionsTransportWs);
    assert(!Array.isArray(wsServer));

    return [
      'legacy',
      wsServer,
      subscriptionsTransportWs.create(
        {
          schema,
          execute,
          subscribe,
          onConnect() {
            return contextFactory({});
          },
        },
        wsServer
      ),
    ] as const;
  };
}

import assert from 'assert';

import { Envelop } from '@envelop/types';

import type WebSocket from 'ws';
import type { IncomingMessage } from 'http';
export type SubscriptionsFlag = boolean | 'legacy' | 'all';

export interface SubscriptionContextArgs {
  request: IncomingMessage;
  connectionParams?: Readonly<Record<string, unknown>>;
}

export type BuildSubscriptionContext = (
  args: SubscriptionContextArgs
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type CommonSubscriptionsServer = Promise<
  | ((
      getEnveloped: Envelop<unknown>,
      customContext: BuildSubscriptionContext | undefined
    ) =>
      | readonly ['new', WebSocket.Server]
      | readonly [
          'both',
          (protocol: string | string[] | undefined) => WebSocket.Server,
          readonly [WebSocket.Server, WebSocket.Server]
        ]
      | readonly ['legacy', WebSocket.Server])
  | null
>;

type SubscriptionsTransportOnConnectArgs = [
  connectionParams: Record<string, unknown> | undefined,
  socket: WebSocket,
  connectionContext: {
    request: IncomingMessage;
  }
];

export const CreateSubscriptionsServer = async (flag: SubscriptionsFlag | undefined): CommonSubscriptionsServer => {
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

  const wsServer: WebSocket.Server | [graphqlWsServer: WebSocket.Server, subWsServer: WebSocket.Server] =
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

  return function (getEnveloped, customCtxFactory) {
    const { schema, execute, subscribe, contextFactory } = getEnveloped();

    async function getContext(contextArgs: SubscriptionContextArgs) {
      const [envelopCtx, customCtx] = await Promise.all([contextFactory(contextArgs), customCtxFactory?.(contextArgs)]);
      Object.assign(envelopCtx, customCtx);

      return envelopCtx;
    }

    if (flag === true) {
      assert(!Array.isArray(wsServer));
      assert(useGraphQLWSServer);

      useGraphQLWSServer(
        {
          schema,
          execute,
          subscribe,
          context: ({ connectionParams, extra: { request } }) => {
            return getContext({ connectionParams, request });
          },
        },
        wsServer
      );

      return ['new', wsServer] as const;
    } else if (flag === 'all') {
      assert(subscriptionsTransportWs);
      assert(useGraphQLWSServer);
      assert(Array.isArray(wsServer));

      useGraphQLWSServer(
        {
          schema,
          context: ({ connectionParams, extra: { request } }) => {
            return getContext({ connectionParams, request });
          },
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
          onConnect(...[connectionParams, , { request }]: SubscriptionsTransportOnConnectArgs) {
            return getContext({ connectionParams, request });
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
        wsServer,
      ] as const;
    }

    assert(subscriptionsTransportWs);
    assert(!Array.isArray(wsServer));

    subscriptionsTransportWs.create(
      {
        schema,
        execute,
        subscribe,
        onConnect(...[connectionParams, , { request }]: SubscriptionsTransportOnConnectArgs) {
          return getContext({ connectionParams, request });
        },
      },
      wsServer
    );

    return ['legacy', wsServer] as const;
  };
};

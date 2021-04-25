import assert from 'assert';

import { stripUndefineds } from '../utils/object.js';
import { getPathname } from '../utils/url.js';

import type { Envelop } from '@envelop/types';
import type WebSocket from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Socket } from 'net';
import type { ServerOptions as SubscriptionsTransportOptions } from 'subscriptions-transport-ws/dist/server';
import type { ServerOptions as GraphQLWSOptions } from 'graphql-ws';

export type SubscriptionsFlag = boolean | 'legacy' | 'all';

export interface SubscriptionContextArgs {
  request: IncomingMessage;
  connectionParams?: Readonly<Record<string, unknown>>;
}

export type BuildSubscriptionsContext = (
  args: SubscriptionContextArgs
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type CommonSubscriptionsServerTuple =
  | readonly ['new', WebSocket.Server]
  | readonly [
      'both',
      (protocol: string | string[] | undefined) => WebSocket.Server,
      readonly [WebSocket.Server, WebSocket.Server]
    ]
  | readonly ['legacy', WebSocket.Server];

interface SubscriptionsState {
  closing: boolean;
  wsServers: readonly WebSocket.Server[];
}

function handleUpgrade(httpServer: HttpServer, path: string, wsTuple: CommonSubscriptionsServerTuple): SubscriptionsState {
  const wsServers = wsTuple[0] === 'both' ? wsTuple[2] : ([wsTuple[1]] as const);

  const state: SubscriptionsState = {
    closing: false,
    wsServers,
  };

  httpServer.on('upgrade', (rawRequest: IncomingMessage, socket: Socket, head: Buffer) => {
    const requestUrl = getPathname(rawRequest.url);

    if (state.closing || requestUrl !== path) {
      return wsServers[0].handleUpgrade(rawRequest, socket, head, webSocket => {
        webSocket.close(1001);
      });
    }

    const protocol = rawRequest.headers['sec-websocket-protocol'];

    switch (wsTuple[0]) {
      case 'both': {
        const server = wsTuple[1](protocol);

        return server.handleUpgrade(rawRequest, socket, head, ws => {
          server.emit('connection', ws, rawRequest);
        });
      }
      case 'new':
      case 'legacy': {
        const server = wsTuple[1];

        return server.handleUpgrade(rawRequest, socket, head, ws => {
          server.emit('connection', ws, rawRequest);
        });
      }
    }
  });

  return state;
}

export interface WebsocketSubscriptionsOptions {
  subscriptionsTransport?: Omit<SubscriptionsTransportOptions, 'schema' | 'execute' | 'subscribe' | 'onConnect'>;
  graphQLWS?: Omit<GraphQLWSOptions, 'schema' | 'execute' | 'subscribe' | 'context' | 'validate'>;
}

export type CommonSubscriptionsServer = Promise<
  | ((
      getEnveloped: Envelop<unknown>,
      customContext: BuildSubscriptionsContext | undefined,
      options: WebsocketSubscriptionsOptions | undefined
    ) => (httpServer: HttpServer, path: string) => SubscriptionsState)
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
      ? import('subscriptions-transport-ws/dist/server.js').then(v => v.SubscriptionServer)
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

  return function (getEnveloped, customCtxFactory, options: WebsocketSubscriptionsOptions | undefined) {
    const { schema, execute, subscribe, contextFactory, validate } = getEnveloped();

    async function getContext(contextArgs: SubscriptionContextArgs) {
      if (customCtxFactory) {
        return contextFactory(Object.assign({}, await customCtxFactory(contextArgs)));
      }
      return contextFactory(contextArgs);
    }

    let wsTuple: CommonSubscriptionsServerTuple;

    if (flag === true) {
      assert(!Array.isArray(wsServer));
      assert(useGraphQLWSServer);

      useGraphQLWSServer(
        {
          ...stripUndefineds(options?.graphQLWS),
          schema,
          execute,
          subscribe,
          context: ({ connectionParams, extra: { request } }) => {
            return getContext({ connectionParams, request });
          },
          validate,
        },
        wsServer
      );

      wsTuple = ['new', wsServer];
    } else if (flag === 'all') {
      assert(subscriptionsTransportWs);
      assert(useGraphQLWSServer);
      assert(Array.isArray(wsServer));

      useGraphQLWSServer(
        {
          ...stripUndefineds(options?.graphQLWS),
          schema,
          execute,
          subscribe,
          context: ({ connectionParams, extra: { request } }) => {
            return getContext({ connectionParams, request });
          },
          validate,
        },
        wsServer[0]
      );

      subscriptionsTransportWs.create(
        {
          ...stripUndefineds(options?.subscriptionsTransport),
          schema,
          execute,
          subscribe,
          onConnect(...[connectionParams, , { request }]: SubscriptionsTransportOnConnectArgs) {
            return getContext({ connectionParams, request });
          },
        },
        wsServer[1]
      );

      wsTuple = [
        'both',
        (protocol: string | string[] | undefined) => {
          const protocols = Array.isArray(protocol) ? protocol : protocol?.split(',').map(p => p.trim());

          return protocols?.includes(GRAPHQL_WS) && !protocols.includes(GRAPHQL_TRANSPORT_WS_PROTOCOL)
            ? wsServer[1]
            : wsServer[0];
        },
        wsServer,
      ];
    } else {
      assert(subscriptionsTransportWs);
      assert(!Array.isArray(wsServer));

      subscriptionsTransportWs.create(
        {
          ...stripUndefineds(options?.subscriptionsTransport),
          schema,
          execute,
          subscribe,
          onConnect(...[connectionParams, , { request }]: SubscriptionsTransportOnConnectArgs) {
            return getContext({ connectionParams, request });
          },
        },
        wsServer
      );

      wsTuple = ['legacy', wsServer];
    }

    return function (httpServer, path) {
      return handleUpgrade(httpServer, path, wsTuple);
    };
  };
};

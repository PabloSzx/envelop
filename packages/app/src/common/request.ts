import {
  ExecutionContext,
  getGraphQLParameters,
  MultipartResponse,
  processRequest,
  Push,
  Request,
  Response,
} from 'graphql-helix';

import type { Envelop } from '@envelop/core';
import type { IncomingMessage, ServerResponse } from 'http';

export async function handleRequest<BuildContextArgs, TReturn = unknown>({
  request,
  getEnveloped,
  buildContextArgs,
  buildContext,
  onResponse,
  onMultiPartResponse,
  onPushResponse,
}: {
  request: Request;
  getEnveloped: Envelop<unknown>;

  buildContextArgs: () => BuildContextArgs;
  buildContext: ((args: BuildContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined;

  onResponse: (result: Response<unknown, unknown>, defaultHandle: typeof defaultResponseHandle) => TReturn | Promise<TReturn>;
  onMultiPartResponse: (
    result: MultipartResponse<unknown, unknown>,
    defaultHandle: typeof defaultMultipartResponseHandle
  ) => TReturn | Promise<TReturn>;
  onPushResponse: (result: Push<unknown, unknown>, defaultHandle: typeof defaultPushResponseHandle) => TReturn | Promise<TReturn>;
}): Promise<TReturn> {
  const { operationName, query, variables } = getGraphQLParameters(request);

  const { parse, validate, contextFactory: contextFactoryEnvelop, execute, schema, subscribe } = getEnveloped();

  async function contextFactory(helixCtx: ExecutionContext) {
    if (buildContext) {
      return contextFactoryEnvelop(Object.assign({}, helixCtx, await buildContext(buildContextArgs())));
    }

    return contextFactoryEnvelop(helixCtx);
  }

  const result = await processRequest({
    operationName,
    query,
    variables,
    request,
    schema,
    parse,
    validate,
    contextFactory,
    execute,
    subscribe,
  });

  switch (result.type) {
    case 'RESPONSE': {
      return onResponse(result, defaultResponseHandle);
    }
    case 'MULTIPART_RESPONSE': {
      return onMultiPartResponse(result, defaultMultipartResponseHandle);
    }
    case 'PUSH': {
      return onPushResponse(result, defaultPushResponseHandle);
    }
  }
}

export function defaultResponseHandle(_req: IncomingMessage, res: ServerResponse, result: Response<unknown, unknown>): void {
  res.writeHead(result.status, {
    'content-type': 'application/json',
  });

  res.end(JSON.stringify(result.payload));
}

export async function defaultMultipartResponseHandle(
  req: IncomingMessage,
  res: ServerResponse,
  result: MultipartResponse<unknown, unknown>
): Promise<void> {
  res.writeHead(200, {
    Connection: 'keep-alive',
    'Content-Type': 'multipart/mixed; boundary="-"',
    'Transfer-Encoding': 'chunked',
    'Content-Encoding': 'none',
  });

  req.on('close', () => {
    result.unsubscribe();
  });

  res.write('---');

  await result.subscribe(result => {
    const chunk = Buffer.from(JSON.stringify(result), 'utf8');
    const data = ['', 'Content-Type: application/json; charset=utf-8', 'Content-Length: ' + String(chunk.length), '', chunk];

    if (result.hasNext) {
      data.push('---');
    }

    res.write(data.join('\r\n'));
  });

  res.write('\r\n-----\r\n');
  res.end();
}

export async function defaultPushResponseHandle(
  req: IncomingMessage,
  res: ServerResponse,
  result: Push<unknown, unknown>
): Promise<void> {
  res.writeHead(200, {
    'Content-Encoding': 'none',
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });

  req.on('close', () => {
    result.unsubscribe();
  });

  await result.subscribe(result => {
    res.write(`data: ${JSON.stringify(result)}\n\n`);
  });
}

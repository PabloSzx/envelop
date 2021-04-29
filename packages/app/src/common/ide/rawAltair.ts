import { LazyPromise } from '../utils/promise.js';

import type { RenderOptions } from 'altair-static';
import type { IncomingMessage, ServerResponse } from 'http';

export interface RawAltairHandlerOptions extends Omit<RenderOptions, 'baseURL'> {
  path: string;
}

export function RawAltairHandlerDeps(
  options: RawAltairHandlerOptions
): {
  path: string;
  baseURL: string;
  renderOptions: RenderOptions;
  deps: Promise<{
    getDistDirectory: typeof import('altair-static').getDistDirectory;
    renderAltair: typeof import('altair-static').renderAltair;
    readFile: typeof import('fs').promises.readFile;
    resolve: typeof import('path').resolve;
    lookup: typeof import('mime-types').lookup;
  }>;
} {
  let { path = '/altair', ...renderOptions } = options;

  const baseURL = path.endsWith('/') ? (path = path.slice(0, path.length - 1)) + '/' : path + '/';

  const deps = LazyPromise(async () => {
    const [
      { getDistDirectory, renderAltair },
      {
        promises: { readFile },
      },
      { resolve },
      { lookup },
    ] = await Promise.all([import('altair-static'), import('fs'), import('path'), import('mime-types')]);

    return {
      getDistDirectory,
      renderAltair,
      readFile,
      resolve,
      lookup,
    };
  });

  return {
    path,
    baseURL,
    renderOptions,
    deps,
  };
}

export function RawAltairHandler(options: RawAltairHandlerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { path, baseURL, deps, renderOptions } = RawAltairHandlerDeps(options);

  return async function (req, res) {
    try {
      const { renderAltair, getDistDirectory, readFile, resolve, lookup } = await deps;

      switch (req.url) {
        case path:
        case baseURL: {
          res.setHeader('content-type', 'text/html');
          return res.end(
            renderAltair({
              ...renderOptions,
              baseURL,
            })
          );
        }
        case undefined: {
          return res.writeHead(404).end();
        }
        default: {
          const resolvedPath = resolve(getDistDirectory(), req.url.slice(baseURL.length));

          const result = await readFile(resolvedPath).catch(() => {});

          if (!result) return res.writeHead(404).end();

          const contentType = lookup(resolvedPath);
          if (contentType) res.setHeader('content-type', contentType);
          return res.end(result);
        }
      }
    } catch (err) {
      res
        .writeHead(500, {
          'content-type': 'application/json',
        })
        .end(
          JSON.stringify({
            message: err.message,
          })
        );
    }
  };
}

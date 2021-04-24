import { renderGraphiQL } from 'graphql-helix';
import type { RenderOptions } from 'altair-static';
import type { RenderGraphiQLOptions } from 'graphql-helix/dist/types';
import { stripUndefineds } from './utils.js';

export interface GraphiQLOptions extends RenderGraphiQLOptions {
  /**
   * @default "/graphiql"
   */
  path?: string;
}

const defaultGraphiQLOptions: GraphiQLOptions & { path: string } = {
  path: '/graphiql',
};

export interface AltairOptions extends RenderOptions {
  /**
   * @default "/altair"
   */
  path?: string;
}

const defaultAltairOptions: AltairOptions = {};

export type IDEOptions<
  TAltairOptions extends AltairOptions = AltairOptions,
  TGraphiQLOptions extends GraphiQLOptions = GraphiQLOptions
> =
  | boolean
  | {
      altair?: boolean | TAltairOptions;
      graphiql?: boolean | TGraphiQLOptions;
    };

export interface InternalIDEOptions<AltairOptions extends RenderOptions = RenderOptions> {
  handleAltair: (options: AltairOptions) => Promise<void>;
  handleGraphiQL: (graphiqlHTML: GraphiQLOptions & { html: string; path: string }) => void | Promise<void>;
}

export async function handleIDE(userOptions: IDEOptions = true, internal: InternalIDEOptions): Promise<void> {
  if (!userOptions) return;

  const options = typeof userOptions === 'boolean' ? { altair: true, graphiql: false } : userOptions;

  const altairOptions = {
    ...defaultAltairOptions,
    ...(typeof options.altair === 'boolean' ? {} : stripUndefineds(options.altair) || {}),
  };
  const graphiQLOptions = {
    ...defaultGraphiQLOptions,
    ...(typeof options.graphiql === 'boolean' ? {} : stripUndefineds(options.graphiql) || {}),
  };

  const isAltairEnabled = !!options.altair;

  const isGraphiQLEnabled = !!options.graphiql;

  await Promise.all([
    isAltairEnabled ? internal.handleAltair(altairOptions) : null,
    isGraphiQLEnabled
      ? internal.handleGraphiQL({
          ...graphiQLOptions,
          html: renderGraphiQL(graphiQLOptions),
        })
      : null,
  ]);
}
// TODO
import { gql, Module, TypeDefs } from 'graphql-modules';

import { BaseEnvelopAppOptions, createEnvelopAppFactory } from '../common/index.js';

import type { Request, Response, Router } from 'express';
import type { EnvelopModuleConfig } from '../common/types';

export interface ExpressEnvelopApp {
  EnvelopAppRouter: Router;
}

export interface ExpressContextArgs {
  request: Request;
  response: Response;
}

export interface ExpressEnvelopAppOptions extends BaseEnvelopAppOptions {
  /**
   * Build Context
   */
  buildContext?: (args: ExpressContextArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface ExpressEnvelopContext {
  request: Request;
  response: Response;
}

export interface ExpressEnvelopAppBuilder {
  gql: typeof gql;
  modules: Module[];
  registerModule: (typeDefs: TypeDefs, options?: EnvelopModuleConfig | undefined) => Module;
  buildApp(prepare: () => void | Promise<void>): Promise<ExpressEnvelopApp>;
}

export function CreateExpressApp(config: ExpressEnvelopAppOptions = {}): ExpressEnvelopAppBuilder {
  const { appBuilder, gql, modules, registerModule } = createEnvelopAppFactory(config, {
    contextTypeName: 'ExpressEnvelopContext',
  });

  async function buildApp(prepare?: () => void | Promise<void>): Promise<ExpressEnvelopApp> {
    return appBuilder({
      prepare,
      async adapterFactory(_getEnveloped) {
        // TODO
        const { Router } = await import('express');
        const EnvelopAppRouter = Router();

        EnvelopAppRouter.use((_req, res) => {
          res.status(500).send('WIP');
        });

        return {
          EnvelopAppRouter,
        };
      },
    });
  }

  return {
    gql,
    modules,
    registerModule,
    buildApp,
  };
}

export { gql };

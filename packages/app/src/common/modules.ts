import { isDocumentNode } from '@graphql-tools/utils';
import { createModule, Module, TypeDefs } from 'graphql-modules';

import type { EnvelopModuleConfig } from './types';

export interface RegisterModule {
  (module: Module): Module;
  (typeDefs: TypeDefs, options?: EnvelopModuleConfig): Module;
}

export interface RegisterModuleState {
  registerModuleState: {
    acumId: number;
  };

  registerModule: RegisterModule;
}

export function RegisterModuleFactory(modules: Module[]): RegisterModuleState {
  const state: RegisterModuleState = {
    registerModuleState: {
      acumId: 0,
    },
    registerModule,
  };

  return state;

  function registerModule(typeDefs: TypeDefs, config?: EnvelopModuleConfig): Module;
  function registerModule(module: Module): Module;
  function registerModule(firstParam: TypeDefs | Module, options?: EnvelopModuleConfig) {
    let module: Module;

    if (Array.isArray(firstParam) || isDocumentNode(firstParam)) {
      const { id = `module${++state.registerModuleState.acumId}`, autoAdd = true } = options || {};

      module = createModule({
        typeDefs: firstParam,
        id,
        ...options,
      });

      if (autoAdd) modules.push(module);

      return module;
    }

    modules.push(firstParam);
    return firstParam;
  }
}
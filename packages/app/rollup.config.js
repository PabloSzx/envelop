import globby from 'globby';
import esbuild from 'rollup-plugin-esbuild';
import path from 'path';
import externals from 'rollup-plugin-node-externals';

const input = globby.sync(path.join(__dirname, 'src/**/*.ts'));

/**
 * @type {import("rollup").RollupOptions}
 */
const config = {
  input,
  output: [
    {
      dir: path.resolve(__dirname, 'dist'),
      format: 'cjs',
      preserveModules: true,
    },
    {
      dir: path.resolve(__dirname, 'dist'),
      format: 'es',
      entryFileNames: '[name].mjs',
      preserveModules: true,
    },
  ],
  plugins: [
    esbuild({
      target: 'es2019',
    }),
    externals({
      packagePath: path.resolve(__dirname, 'package.json'),
      deps: true,
    }),
  ],
};

export default config;

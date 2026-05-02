// Bundle the plugin into a single file so it can be dropped into the
// OpenCode plugins directory without needing node_modules.
import { build } from 'esbuild'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(__dirname, '../dist/index.js')],
  bundle: true,
  outfile: join(__dirname, '../dist/yeap.js'),
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // OpenCode plugins run in the same process — mark these as external
  external: ['@opencode-ai/plugin'],
})

console.log('Plugin bundled → dist/yeap.js')

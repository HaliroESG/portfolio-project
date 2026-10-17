// Local fixture host only. UI inspection uses the approved computer-use browser.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-p0-readers-'))
fs.writeFileSync(path.join(output, 'loader.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText}`)
fs.writeFileSync(path.join(output, 'shell.jsx'), 'export function AppShell({children}) { return children }')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', devtool: false, context: root, entry: './scripts/fixtures/p0-readers-browser.jsx', output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'], modules: [path.join(root, 'node_modules')], alias: {
      [path.join(root, 'components/AppShell')]: path.join(output, 'shell.jsx'),
      [path.join(root, 'lib/supabase')]: path.join(root, 'scripts/fixtures/p0-readers-supabase.js'),
    } },
    module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const cssDir = path.join(root, '.next/static/chunks')
const css = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(x => x.endsWith('.css')).map(x => fs.readFileSync(path.join(cssDir, x), 'utf8')).join('\n') : ''
if (!css) throw new Error('Build CSS required before rendered QA')
const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>ASTROCYTE P0 local QA</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'")
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))) }
  else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css) }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ localQA: `http://127.0.0.1:${server.address().port}/publications`, fixture: 'synthetic only', providerIO: 'disabled', output })))

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

export function createLoader(dependencies = {}, globals = {}) {
  const cache = new Map()
  const load = (path, parent = import.meta.url) => {
    const url = new URL(path, parent)
    if (!url.pathname.endsWith('.ts')) url.pathname += '.ts'
    if (cache.has(url.href)) return cache.get(url.href)
    const source = readFileSync(url, 'utf8')
    const exports = {}
    cache.set(url.href, exports)
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      {
        exports,
        URL,
        URLSearchParams,
        Buffer,
        AbortSignal,
        Error,
        DOMException,
        process,
        Date,
        fetch,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
        __dirname: fileURLToPath(new URL('.', url)),
        ...globals,
        require: (name) => {
          if (Object.hasOwn(dependencies, name)) return dependencies[name]
          if (name.startsWith('node:')) return require(name)
          if (name.startsWith('.')) return load(name, url)
          assert.fail(`Unexpected dependency: ${name}`)
        }
      },
      { filename: fileURLToPath(url) }
    )
    return exports
  }
  return load
}

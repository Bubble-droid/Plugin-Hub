import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Detects plugin paths built from env.basePath + "/data/...". On Linux the
// host resolves relative data paths against the XDG data directory, so manual
// basePath concatenation reads and writes the wrong location.
//
// Usage: node scripts/check-base-paths.mjs [file-or-dir ...]
// Exits with 1 when a suspicious path is found.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultDir = path.join(root, 'plugins')
const extensions = new Set(['.js', '.mjs', '.cjs'])
const ignoredDirs = new Set(['node_modules', '.git'])

// basePath in any casing, as a property, bracket access, or bare name.
const baseSource = `(?:(?:\\.|\\?\\.)\\s*base_?path\\b|\\[\\s*['"]base_?path['"]\\s*\\]|\\bbase_?path\\b)`
const dataSource = (names) => (names.length ? `(?:${names.map(escapeRegExp).join('|')})` : null)

const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n]+)/g
const destructuring = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([^\n]+)/g

const targets = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('-'))
  .map((arg) => path.resolve(arg))
const roots = targets.length ? targets : [defaultDir]
const findings = []

for (const target of roots) {
  for (const file of await collectFiles(target)) await checkFile(file)
}

if (!findings.length) {
  console.log('No env.basePath + "/data/..." style paths found.')
  process.exit(0)
}

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}:${finding.column}  ${finding.kind}`)
  console.log(`  ${finding.code}`)
  console.log(`  suggestion: use Plugins.AbsolutePath('data/...') or a relative 'data/...' path instead of concatenating env.basePath.`)
}

console.log()
console.log(`Found ${findings.length} suspicious path construction(s) in ${new Set(findings.map((finding) => finding.file)).size} file(s).`)
process.exit(1)

async function collectFiles(target) {
  const entries = await readdir(target, { withFileTypes: true }).catch(() => null)
  if (!entries) return extensions.has(path.extname(target)) ? [target] : []

  const files = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) files.push(...(await collectFiles(path.join(target, entry.name))))
      continue
    }

    if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(path.join(target, entry.name))
  }

  return files.sort()
}

async function checkFile(file) {
  const source = await readFile(file, 'utf8')
  const code = stripComments(source)
  const constants = collectConstants(code)
  const dataPattern = dataSource(constants.dataNames)
  const aliases = constants.aliases.map(escapeRegExp)
  const baseExpression = new RegExp(`(?:${baseSource}${aliases.length ? `|\\b(?:${aliases.join('|')})\\b` : ''})`, 'i')
  const matchers = createMatchers(baseExpression, dataPattern, constants.dataNames)
  const sourceLines = source.split('\n')
  const codeLines = code.split('\n')

  for (let index = 0; index < codeLines.length; index++) {
    const line = codeLines[index]
    const match = baseExpression.exec(line)
    if (!match) continue

    const matcher = matchers.find((matcher) => matcher.test(line))
    if (!matcher) continue

    findings.push({
      file: displayPath(file),
      line: index + 1,
      column: match.index + 1,
      kind: matcher.kind,
      code: sourceLines[index].trim()
    })
  }
}

function createMatchers(baseExpression, dataPattern, dataNames) {
  const base = baseExpression.source
  const matchers = [
    {
      kind: 'template literal',
      test: (line) => new RegExp(`\\$\\{[^}]*${base}[^}]*\\}\\s*[\\\\/]*data\\b`, 'i').test(line)
    },
    {
      kind: 'string concatenation',
      test: (line) => new RegExp(`${base}\\s*\\+\\s*['"\`]\\s*[\\\\/]*data\\b`, 'i').test(line)
    },
    {
      kind: 'string concatenation with a data variable',
      test: (line) =>
        dataPattern &&
        new RegExp(`${base}\\s*\\+\\s*(['"\`])\\s*[\\\\/]+\\s*\\1\\s*\\+\\s*\\(?\\s*(?:${dataPattern}|['"\`]\\s*[\\\\/]*data\\b)`, 'i').test(line)
    },
    {
      kind: 'path separator concatenation',
      test: (line) =>
        new RegExp(
          `${base}\\s*\\+\\s*(?:path\\s*\\.\\s*sep|(?:[A-Za-z_$][\\w$]*)?sep[A-Za-z_$]*|['"\`]\\s*[\\\\/]+\\s*['"\`])\\s*\\+\\s*['"\`]\\s*[\\\\/]*data\\b`,
          'i'
        ).test(line)
    },
    {
      kind: 'template literal with a data variable',
      test: (line) => dataPattern && new RegExp(`\\$\\{[^}]*${base}[^}]*\\}\\s*\\/\\s*\\$\\{${dataPattern}\\}`, 'i').test(line)
    },
    {
      kind: 'concatenated template with a data variable',
      test: (line) => dataPattern && new RegExp(`${base}\\s*\\+\\s*\`\\s*\\/\\s*\\$\\{${dataPattern}\\}`, 'i').test(line)
    },
    {
      kind: '.concat()',
      test: (line) => new RegExp(`${base}\\s*(?:\\?\\.|\\.)\\s*concat\\s*\\([^)]*(?:[\\\\/]*data\\b|${dataPattern || 'a^'})`, 'i').test(line)
    },
    {
      kind: 'path.join()',
      test: (line) => /\bpath\s*\.\s*(?:join|resolve)\s*\(/i.test(line) && (/['"\`]\s*[\\/]*data\b/i.test(line) || hasDataName(line, dataNames))
    },
    {
      kind: 'array join',
      test: (line) => /\.join\s*\(/.test(line) && (/['"\`]\s*[\\/]*data\b/i.test(line) || hasDataName(line, dataNames))
    }
  ]

  return matchers.filter((matcher) => matcher.test)
}

function hasDataName(line, names) {
  return names.length > 0 && new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`).test(line)
}

function collectConstants(code) {
  const raw = new Map()
  const values = new Map()
  const aliases = new Set()
  const dataNames = new Set()
  const basePattern = new RegExp(baseSource, 'i')
  let match

  declaration.lastIndex = 0
  while ((match = declaration.exec(code))) {
    raw.set(match[1], match[2].trim().replace(/;\s*$/, ''))
  }

  destructuring.lastIndex = 0
  while ((match = destructuring.exec(code))) {
    for (const part of match[1].split(',')) {
      const alias = /^\s*base_?path(?:\s*:\s*([A-Za-z_$][\w$]*))?(?:\s*=[^,]+)?\s*$/i.exec(part)
      if (alias) aliases.add(alias[1] || 'basePath')
    }
  }

  for (const [name, expression] of raw) {
    if (basePattern.test(expression)) aliases.add(name)
  }

  const resolve = (name, seen) => {
    if (values.has(name)) return values.get(name)
    if (!raw.has(name) || seen.has(name)) return null

    const value = resolveExpression(raw.get(name), (next) => resolve(next, new Set([...seen, name])), new Set([...seen, name]))
    if (value !== null) values.set(name, value)

    return value
  }

  for (const name of raw.keys()) resolve(name, new Set())

  for (const [name, expression] of raw) {
    const value = values.get(name)
    if (value !== undefined && /^[\\/]*data(?:[\\/]|$)/.test(value)) dataNames.add(name)
    else if (/^['"\`][\\/]*data(?:[\\/]|['"\`])/.test(expression)) dataNames.add(name)
  }

  return { aliases: [...aliases], dataNames: [...dataNames] }
}

function resolveExpression(expression, resolveName, seen) {
  let text = expression.trim().replace(/;\s*$/, '').trim()

  while (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim()

  const quoted = /^'((?:\\.|[^'\\])*)'$/.exec(text) || /^"((?:\\.|[^"\\])*)"$/.exec(text)
  if (quoted) return quoted[1]

  const template = /^`([^`]*)`$/.exec(text)
  if (template) return resolveTemplate(template[1], resolveName, seen)

  const parts = splitTopLevel(text, '+')
  if (parts.length > 1) {
    const resolved = parts.map((part) => resolveExpression(part, resolveName, seen))
    return resolved.every((value) => value !== null) ? resolved.join('') : null
  }

  return /^[A-Za-z_$][\w$]*$/.test(text) ? resolveName(text) : null
}

function resolveTemplate(body, resolveName, seen) {
  let result = ''
  let index = 0

  while (index < body.length) {
    if (!body.startsWith('${', index)) {
      result += body[index++]
      continue
    }

    let depth = 1
    let end = index + 2
    while (end < body.length && depth > 0) {
      if (body[end] === '{') depth++
      else if (body[end] === '}') depth--
      end++
    }
    if (depth !== 0) return null

    const value = resolveExpression(body.slice(index + 2, end - 1), resolveName, seen)
    if (value === null) return null

    result += value
    index = end
  }

  return result
}

function splitTopLevel(text, separator) {
  const parts = []
  let current = ''
  let depth = 0
  let quote = ''

  for (let index = 0; index < text.length; index++) {
    const char = text[index]

    if (quote) {
      current += char
      if (char === '\\') current += text[++index] || ''
      else if (char === quote) quote = ''
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }

    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--

    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

// Keep columns stable while ignoring commented-out code.
function stripComments(source) {
  let result = ''
  let quote = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (quote) {
      result += char
      if (char === '\\') {
        result += next || ''
        index += 2
        continue
      }
      if (char === quote) quote = ''
      index++
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      result += char
      index++
      continue
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        result += ' '
        index++
      }
      continue
    }

    if (char === '/' && next === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        result += source[index] === '\n' ? '\n' : ' '
        index++
      }
      result += '  '
      index += 2
      continue
    }

    result += char
    index++
  }

  return result
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function displayPath(file) {
  const relative = path.relative(root, file)
  return relative.startsWith('..') ? file : relative.split(path.sep).join('/')
}

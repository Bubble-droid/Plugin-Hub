import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = path.join(root, 'plugins')

/** Plugin directories mapped to the catalog that is expected to list them. */
const targets = [
  { directory: 'Extra', catalog: 'nsfw.json' },
  { directory: 'Generic', catalog: 'generic.json' },
  { directory: 'GFC', catalog: 'gfc.json' },
  { directory: 'GFS', catalog: 'gfs.json' }
]

const urlPattern = /^https:\/\/raw\.githubusercontent\.com\/GUI-for-Cores\/Plugin-Hub\/(?:refs\/heads\/)?main\/(plugins\/.+)$/

/** Recursively collect files below `directory`, ignoring dotfiles. */
const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

/** Map every plugin file referenced by a catalog to the catalogs listing it. */
const registrations = new Map()
const errors = []

for (const { catalog } of targets) {
  const file = path.join(pluginsDir, catalog)
  let plugins
  try {
    plugins = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    errors.push(`${catalog}: could not be read as JSON (${error.message})`)
    continue
  }

  for (const plugin of plugins) {
    const match = urlPattern.exec(plugin.url || '')
    if (!match) {
      errors.push(`${catalog}: ${plugin.id || '<unknown id>'} has an unsupported url: ${plugin.url}`)
      continue
    }
    const relativePath = match[1]
    const catalogs = registrations.get(relativePath) || []
    catalogs.push({ catalog, id: plugin.id })
    registrations.set(relativePath, catalogs)
  }
}

const unregistered = []
const misplaced = []

for (const { directory, catalog } of targets) {
  const directoryPath = path.join(pluginsDir, directory)
  let files
  try {
    files = await walk(directoryPath)
  } catch (error) {
    errors.push(`${directory}/: could not be read (${error.message})`)
    continue
  }

  for (const file of files) {
    const relativePath = path.relative(root, file).split(path.sep).join('/')
    const catalogs = registrations.get(relativePath) || []

    if (catalogs.length === 0) {
      unregistered.push(relativePath)
    } else if (!catalogs.some((registration) => registration.catalog === catalog)) {
      misplaced.push({
        file: relativePath,
        expected: catalog,
        actual: catalogs.map((registration) => `${registration.catalog} (${registration.id})`)
      })
    }
  }
}

if (unregistered.length > 0) {
  console.error(`Plugins not registered in any catalog (${unregistered.length}):`)
  for (const file of unregistered) console.error(`  ${file}`)
  console.error('')
}

if (misplaced.length > 0) {
  console.error(`Plugins registered in the wrong catalog (${misplaced.length}):`)
  for (const { file, expected, actual } of misplaced) {
    console.error(`  ${file} should be in ${expected}, found in ${actual.join(', ')}`)
  }
  console.error('')
}

if (errors.length > 0) {
  console.error(`Catalog errors (${errors.length}):`)
  for (const message of errors) console.error(`  ${message}`)
  console.error('')
}

if (unregistered.length > 0 || misplaced.length > 0 || errors.length > 0) {
  process.exit(1)
}

console.log(`All plugin files in ${targets.map(({ directory }) => `${directory}/`).join(', ')} are registered.`)

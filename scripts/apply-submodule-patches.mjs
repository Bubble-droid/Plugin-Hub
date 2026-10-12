import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reset = process.argv.includes('--reset')
const clean = process.argv.includes('--clean')

const targets = [
  {
    name: 'gui-for-clash',
    dir: 'vendor/gui-for-clash',
    patch: 'patches/gui-for-clash-plugin-apis.patch',
    file: 'frontend/src/assets/globalMethods.ts',
  },
  {
    name: 'gui-for-singbox',
    dir: 'vendor/gui-for-singbox',
    patch: 'patches/gui-for-singbox-plugin-apis.patch',
    file: 'frontend/src/assets/globalMethods.ts',
  },
]

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const fileHash = (cwd, file) => git(cwd, ['hash-object', '--', file])

let failed = false

for (const target of targets) {
  console.log(`\n[${clean ? '还原' : '补丁'}] ${target.name}`)

  const submoduleDir = path.join(root, target.dir)
  const patchPath = path.join(root, target.patch)

  if (!existsSync(submoduleDir)) {
    console.error(`❌ 子模块目录不存在: ${target.dir}（先运行 \`pnpm run sub:init\`）`)
    failed = true
    continue
  }

  const patch = readFileSync(patchPath, 'utf8')
  const index = /^index ([0-9a-f]+)\.\.([0-9a-f]+) /m.exec(patch)
  if (!index) {
    console.error(`❌ 补丁缺少 index 行: ${target.patch}`)
    failed = true
    continue
  }
  const [, baseHash, patchedHash] = index

  let currentHash = fileHash(submoduleDir, target.file)

  if (clean) {
    const headHash = git(submoduleDir, ['rev-parse', `HEAD:${target.file}`])
    if (currentHash === headHash) {
      console.log('✨ 本已洁净，跳过')
      continue
    }
    if (currentHash.startsWith(patchedHash)) {
      git(submoduleDir, ['checkout', '--', target.file])
      console.log('✅ 已还原补丁（更新后由 sub:patch 复施）')
      continue
    }
    console.error(`❌ 文件含补丁以外之改动，不敢擅弃: ${target.file}`)
    failed = true
    continue
  }

  if (currentHash.startsWith(patchedHash)) {
    console.log('✨ 补丁已在位，跳过')
    continue
  }

  if (reset) {
    git(submoduleDir, ['checkout', '--', target.file])
    currentHash = fileHash(submoduleDir, target.file)
  }

  try {
    git(submoduleDir, ['apply', patchPath])
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message
    console.error(`❌ 应用补丁失败: ${detail}`)
    if (currentHash === git(submoduleDir, ['rev-parse', `HEAD:${target.file}`])) {
      console.error(`   上游 HEAD 已偏离补丁基线，请基于新上游再生补丁：`)
      console.error(`   git -C ${target.dir} diff > ${target.patch}`)
    } else {
      console.error(`   文件存在未提交改动，运行 \`node scripts/apply-submodule-patches.mjs --reset\` 可丢弃后重试`)
    }
    failed = true
    continue
  }

  const patched = fileHash(submoduleDir, target.file)
  if (patched.startsWith(patchedHash)) {
    console.log('✅ 已应用补丁')
  } else {
    console.error(`❌ 应用后内容与补丁结果不一致`)
    failed = true
  }
}

console.log('')

if (failed) process.exit(1)

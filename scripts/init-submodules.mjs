import { execFileSync } from 'node:child_process'

// 唯初始化缺失之子模块；已检出者保持现状，绝不倒回 gitlink 所录旧引用
// （pnpm install 经 prepare 触发本脚本，若贸然 git submodule update --init，
//   会将 sub:update 刚更新之子模块拽回旧 SHA，前功尽弃）

const status = execFileSync('git', ['submodule', 'status', '--recursive'], {
  encoding: 'utf8',
}).trim()

const missing = status
  .split('\n')
  .filter((line) => line.startsWith('-'))
  .map((line) => line.slice(1).trim().split(/\s+/)[1])

if (missing.length === 0) {
  console.log('✨ 子模块皆已初始化，保持已检出之引用')
} else {
  console.log(`初始化缺失子模块: ${missing.join(', ')}`)
  execFileSync('git', ['submodule', 'update', '--init', '--recursive', ...missing], {
    stdio: 'inherit',
  })
}

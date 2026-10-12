import fs from 'node:fs';
import path from 'node:path';

// 1. 需要扫描的子模块 package.json
const SUBMODULE_PATHS = [
  'vendor/gui-for-singbox/frontend/package.json',
  'vendor/gui-for-clash/frontend/package.json',
];

const ROOT_PKG_PATH = path.resolve('package.json');

// 去除 ^、~、v 前缀，获取具体精确版本
function cleanVersion(version) {
  if (typeof version !== 'string') return version;
  return version.replace(/^[\^~v]/, '').trim();
}

// 简易 semver 版本对比，用于多子模块冲突时选较高版本
function compareSemver(v1, v2) {
  const c1 = cleanVersion(v1);
  const c2 = cleanVersion(v2);

  const p1 = c1.split('.').map((n) => parseInt(n, 10));
  const p2 = c2.split('.').map((n) => parseInt(n, 10));

  if (p1.some(Number.isNaN) || p2.some(Number.isNaN)) {
    return c1.localeCompare(c2);
  }

  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

function run() {
  if (!fs.existsSync(ROOT_PKG_PATH)) {
    console.error('❌ 未找到根目录 package.json');
    process.exit(1);
  }

  const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, 'utf-8'));
  const rootDevDeps = rootPkg.devDependencies || {};

  // 2. 合并所有子模块的【生产依赖 dependencies】+【开发依赖 devDependencies】
  const submodulesPool = new Map();

  for (const relPath of SUBMODULE_PATHS) {
    const absPath = path.resolve(relPath);
    if (!fs.existsSync(absPath)) {
      console.warn(`⚠️ 跳过不存在的子模块: ${relPath}`);
      continue;
    }

    const subPkg = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    // 合并子模块的 dependencies 与 devDependencies
    const allDeps = {
      ...(subPkg.dependencies || {}),
      ...(subPkg.devDependencies || {}),
    };

    for (const [name, rawVersion] of Object.entries(allDeps)) {
      const fixedVersion = cleanVersion(rawVersion);

      if (!submodulesPool.has(name)) {
        submodulesPool.set(name, fixedVersion);
      } else {
        const existing = submodulesPool.get(name);
        if (existing !== fixedVersion) {
          // 两个子模块版本不一致时，选取更高版本
          if (compareSemver(fixedVersion, existing) > 0) {
            submodulesPool.set(name, fixedVersion);
          }
        }
      }
    }
  }

  // 3. 【核心约束】仅遍历根项目既有的 devDependencies 进行版本同步
  let changed = false;
  let updateCount = 0;

  for (const depName of Object.keys(rootDevDeps)) {
    if (submodulesPool.has(depName)) {
      const targetVersion = submodulesPool.get(depName);
      const currentVersion = rootDevDeps[depName];

      if (currentVersion !== targetVersion) {
        console.log(
          `[同步版本] ${depName}: ${currentVersion} -> ${targetVersion}`,
        );
        rootDevDeps[depName] = targetVersion;
        changed = true;
        updateCount++;
      }
    }
  }

  // 4. 写回 package.json
  if (changed) {
    rootPkg.devDependencies = rootDevDeps;
    fs.writeFileSync(
      ROOT_PKG_PATH,
      JSON.stringify(rootPkg, null, 2) + '\n',
      'utf-8',
    );
    console.log(
      `\n✅ 已同步 ${updateCount} 个依赖的具体版本至根项目的 devDependencies。`,
    );
    console.log('📌 请执行 `pnpm install` 刷新锁定文件');
  } else {
    console.log(
      '\n✨ 根项目的既有依赖版本已与子模块完全一致（且均为具体版本），无需修改。',
    );
  }
}

run();

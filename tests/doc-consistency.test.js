/**
 * 文档与脚本一致性校验
 *
 * 复现问题：
 *  1. README 写 npm run build 但 package.json 无此脚本
 *  2. README 未区分 Electron 桌面模式和浏览器模式的验收口径
 *
 * 运行方式：node tests/doc-consistency.test.js
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    console.log(`  ❌ FAIL: ${msg}`);
    failures++;
  }
};

console.log('\n========== 文档与脚本一致性校验 ==========\n');

// ---- 1. 读取 package.json 的 scripts ----
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
const scripts = pkg.scripts || {};
console.log('package.json scripts:', JSON.stringify(scripts, null, 2));

// ---- 2. 读取 README.md 内容 ----
const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8');

// ---- 3. 校验：README 中引用的每条 npm run 命令必须在 package.json 中存在 ----
console.log('\n【校验1】README 引用的 npm run 命令必须在 package.json 中存在');

const npmRunRegex = /npm run ([\w:-]+)/g;
let match;
const readmeCommands = [];
while ((match = npmRunRegex.exec(readme)) !== null) {
  readmeCommands.push(match[1]);
}
const uniqueCommands = [...new Set(readmeCommands)];
console.log(`  README 中引用的命令: ${uniqueCommands.join(', ')}`);

for (const cmd of uniqueCommands) {
  assert(scripts[cmd] !== undefined, `npm run ${cmd} 在 package.json 中存在`);
}

// ---- 4. 校验：Electron 主进程能找到构建产物 ----
console.log('\n【校验2】Electron 生产模式加载路径与 Vite 构建产物路径一致');
const mainJs = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf-8');
const loadFileMatch = mainJs.match(/loadFile\(([^)]+)\)/);
if (loadFileMatch) {
  console.log(`  Electron loadFile 路径: ${loadFileMatch[1]}`);
  assert(loadFileMatch[0].includes('dist/index.html'), 'Electron 生产模式加载 dist/index.html');
} else {
  console.log('  ⚠️ 未找到 loadFile 调用（可能只配置了开发模式）');
}

// ---- 5. 校验：README 中有明确的 Electron 桌面模式说明 ----
console.log('\n【校验3】README 区分了 Electron 桌面模式和浏览器模式');
assert(readme.includes('npm run dev'), 'README 包含 npm run dev（Electron 开发模式）');
assert(
  readme.includes('Electron') && (readme.includes('桌面版') || readme.includes('桌面应用')),
  'README 提及 Electron 桌面应用'
);

// ---- 6. 校验：构建命令可实际执行 ----
console.log('\n【校验4】构建命令是否可实际执行（仅检查脚本名存在性）');
const buildCmd = uniqueCommands.find(c => c.includes('build'));
if (buildCmd) {
  assert(scripts[buildCmd] !== undefined, `构建命令 npm run ${buildCmd} 存在于 package.json`);
  console.log(`  脚本内容: ${scripts[buildCmd]}`);
} else {
  console.log('  ⚠️ README 中未引用任何构建命令');
}

// ---- 7. 校验：package.json main 字段指向 Electron 入口 ----
console.log('\n【校验5】package.json main 字段正确指向 Electron 入口');
assert(pkg.main === 'electron/main.js', `main 字段 = "${pkg.main}"，期望 "electron/main.js"`);

// ---- 结果 ----
console.log('\n========== 校验结果 ==========');
if (failures > 0) {
  console.log(`❌ 共 ${failures} 项失败，文档与脚本不一致，需要修复。\n`);
  process.exit(1);
} else {
  console.log('✅ 全部通过，文档与脚本一致。\n');
  process.exit(0);
}

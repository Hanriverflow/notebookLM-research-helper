import { execFileSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tests = (await readdir(path.join(root, 'tests'))).filter(file => file.endsWith('.test.js')).sort().map(file => path.join('tests', file));
const checks = [
  ['tests', process.execPath, ['--test', '--test-reporter=tap', ...tests]],
  ['extension', process.execPath, ['tools/check.mjs']],
  ['build', 'python', ['tools/build-package.py']],
  ['package', 'python', ['qa/improvements/verify-package.py']],
];
const result = { checkedAt: new Date().toISOString(), checks: [], browserVerification: 'Not completed. Computer Use stopped because it could not verify the browser URL.' };
for (const [name, executable, args] of checks) {
  try {
    const output = execFileSync(executable, args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    result.checks.push({ name, passed: true, output });
    console.log(`${name}: passed`);
  } catch (error) {
    result.checks.push({ name, passed: false, output: String(error.stdout || '') + String(error.stderr || error.message) });
    process.exitCode = 1;
    console.error(`${name}: failed`);
    break;
  }
}
await writeFile(path.join(root, 'qa/improvements/local-results.json'), JSON.stringify(result, null, 2) + '\n');

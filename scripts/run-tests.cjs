const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs.readdirSync(path.join(__dirname, '../tests')).filter(name => name.endsWith('.test.ts') && (!process.argv[2] || name === process.argv[2])).sort();
if (!files.length) { console.error('Nenhum teste encontrado.'); process.exit(1); }
let total = 0;
for (const file of files) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--require', './tests/register.cjs', './tests/' + file], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) console.error('Falha ao iniciar teste: ' + result.error.message);
  const summary = result.stdout?.match(/^# tests (\d+)$/m);
  if (result.status !== 0 || !summary || Number(summary[1]) === 0) process.exit(result.status || 1);
  total += Number(summary[1]);
}
console.log(`Verified ${total} tests in ${files.length} isolated test files.`);

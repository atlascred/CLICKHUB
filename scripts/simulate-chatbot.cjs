const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const run = spawnSync(process.execPath, ['--require', './tests/register.cjs', '--test', 'tests/chatbot.test.ts'], {
  encoding: 'utf8', env: { ...process.env, LILY_SIMULATION_REPORT: '1' },
});
const output = (run.stdout || '') + (run.stderr || '');
process.stdout.write(output);
mkdirSync('.test-output', { recursive: true });
writeFileSync('.test-output/lily-tests.tap', output);
const count = key => Number(output.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1] || 0);
writeFileSync('.test-output/lily-summary.json', JSON.stringify({ scenarios: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), exitCode: run.status }, null, 2));
process.exitCode = run.status ?? 1;

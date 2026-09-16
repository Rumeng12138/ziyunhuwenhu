const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const launcher = path.join(__dirname, '..', '..', 'start-local.cmd');

test('local launcher derives every project path from its own location', () => {
  const script = fs.readFileSync(launcher, 'utf8');

  assert.match(script, /set "SERVER_DIR=%~dp0server"/);
  assert.match(script, /set "STORE_DIR=%~dp0\.pnpm-store"/);
  assert.match(script, /server\\package\.json next to this launcher/);
  assert.doesNotMatch(script, /2026-09-\d{2}/);
});

test('local launcher validates moved pnpm links and repairs from the lockfile', () => {
  const script = fs.readFileSync(launcher, 'utf8');

  assert.match(script, /fs\.realpathSync\(require\.resolve\(name\)\)/);
  assert.match(script, /\['dotenv','better-sqlite3'\]/);
  assert.match(script, /new Database\(':memory:'\)/);
  assert.match(script, /pnpm install --force --frozen-lockfile --store-dir/);
  assert.match(script, /where corepack\.cmd/);
  assert.match(script, /where pnpm\.cmd/);
  assert.match(script, /:repair_with_corepack[\s\S]*exit \/b %errorlevel%/);
  assert.match(script, /:repair_with_pnpm[\s\S]*exit \/b %errorlevel%/);
});

test('local launcher check mode works outside the project directory', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', [
    '/d', '/c', launcher, '--check',
  ], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 15000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Node\.js and dependencies are ready/);
});

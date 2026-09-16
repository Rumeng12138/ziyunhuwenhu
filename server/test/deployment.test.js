const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { once } = require('node:events');

const serverDir = path.join(__dirname, '..');

function isolatedEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of [
    'ADMIN_INITIAL_PASSWORD', 'BACKUP_DIR', 'DATA_DIR', 'DB_PATH',
    'PAYMENT_SETTINGS_DIR', 'STORAGE_DIR', 'UPLOAD_DIR',
  ]) delete env[key];
  return { ...env, ...overrides };
}

function run(script, env) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: serverDir,
    env: isolatedEnv(env),
    encoding: 'utf8',
  });
}

function parseResult(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const marker = '__DEPLOYMENT_RESULT__';
  const line = result.stdout.split(/\r?\n/).find(item => item.startsWith(marker));
  assert.ok(line, result.stdout);
  return JSON.parse(line.slice(marker.length));
}

test('STORAGE_DIR keeps every mutable production artifact on one persistent volume', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziyunhu-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = parseResult(run(
    "console.log('__DEPLOYMENT_RESULT__'+JSON.stringify(require('./config/storage')))",
    { STORAGE_DIR: root },
  ));

  assert.equal(storage.dataDir, root);
  assert.equal(storage.dbPath, path.join(root, 'ziyunhu.db'));
  assert.equal(storage.uploadDir, path.join(root, 'uploads'));
  assert.equal(storage.backupDir, path.join(root, 'backups'));
  assert.equal(storage.paymentSettingsDir, root);
  assert.equal(storage.sessionSecretPath, path.join(root, 'session-signing.key'));
});

test('Render blueprint pins the runtime and mounts all mutable state persistently', () => {
  const blueprint = fs.readFileSync(path.join(serverDir, '..', 'render.yaml'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
  const lockfile = fs.readFileSync(path.join(serverDir, 'pnpm-lock.yaml'), 'utf8');

  assert.equal(packageJson.packageManager, 'pnpm@11.19.0');
  assert.match(packageJson.engines.node, /22\.22\.0/);
  assert.match(blueprint, /rootDir: server/);
  assert.match(blueprint, /NODE_VERSION\s*\n\s*value: 24\.14\.1/);
  assert.match(blueprint, /STORAGE_DIR\s*\n\s*value: \/var\/data/);
  assert.match(blueprint, /mountPath: \/var\/data/);
  assert.match(blueprint, /ADMIN_INITIAL_PASSWORD\s*\n\s*sync: false/);
  assert.match(lockfile, /multer@2\.3\.0/);
  assert.match(lockfile, /urllib@4\.9\.1/);
  assert.match(lockfile, /qs@6\.16\.0/);
});

test('a custom DB_PATH creates its own parent directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziyunhu-db-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'nested', 'database', 'shop.db');
  const output = parseResult(run(
    "const db=require('./config/db');db.prepare('SELECT 1').get();db.close();console.log('__DEPLOYMENT_RESULT__'+JSON.stringify({exists:require('node:fs').existsSync(process.env.DB_PATH)}))",
    { DB_PATH: dbPath },
  ));
  assert.equal(output.exists, true);
});

test('a new production database requires and applies a strong initial admin password', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziyunhu-production-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const password = 'RenderAdmin2026!';
  const output = parseResult(run(
    "require('./config/auth-secret').initialize();const db=require('./config/initDB');const bcrypt=require('bcryptjs');const admin=db.prepare(\"SELECT password FROM users WHERE username='admin' AND is_admin=1\").get();console.log('__DEPLOYMENT_RESULT__'+JSON.stringify({passwordOK:bcrypt.compareSync(process.env.ADMIN_INITIAL_PASSWORD,admin.password),db:require('node:fs').existsSync(require('./config/storage').dbPath),secret:require('node:fs').existsSync(require('./config/storage').sessionSecretPath)}));db.close()",
    {
      NODE_ENV: 'production',
      STORAGE_DIR: root,
      ADMIN_INITIAL_PASSWORD: password,
      JWT_SECRET: 'a'.repeat(64),
    },
  ));
  assert.deepEqual(output, { passwordOK: true, db: true, secret: false });
});

test('a new production database refuses the local-only default administrator', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziyunhu-production-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = run("require('./config/initDB')", {
    NODE_ENV: 'production',
    STORAGE_DIR: root,
    JWT_SECRET: 'b'.repeat(64),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ADMIN_INITIAL_PASSWORD/);
});

test('production mode serves storefront, admin, APIs and persistent uploads', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziyunhu-production-server-'));
  const uploadDir = path.join(root, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'smoke.png'), Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
  ]));

  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: isolatedEnv({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      STORAGE_DIR: root,
      JWT_SECRET: 'production-smoke-secret-0123456789abcdef',
      ADMIN_INITIAL_PASSWORD: 'ProductionAdmin2026',
      PUBLIC_SITE_URL: 'https://shop.example.test',
      CORS_ORIGIN: `http://127.0.0.1:${port}`,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) assert.fail(`production server exited early:\n${output}`);
    try {
      health = await fetch(`${base}/api/health`);
      if (health.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(health?.status, 200, output);

  const [storefront, admin, products, editorial, upload, readiness] = await Promise.all([
    fetch(`${base}/`),
    fetch(`${base}/admin`),
    fetch(`${base}/api/products?pageSize=1`),
    fetch(`${base}/api/editorial-content`),
    fetch(`${base}/uploads/smoke.png`),
    fetch(`${base}/api/readiness`),
  ]);
  assert.equal(storefront.status, 200);
  assert.match(await storefront.text(), /紫云湖/);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /店铺设置/);
  assert.equal(products.status, 200);
  assert.equal((await products.json()).data.list.length, 1);
  assert.equal(editorial.status, 200);
  assert.equal((await editorial.json()).data.sections.length, 5);
  assert.equal(upload.status, 200);
  assert.equal(upload.headers.get('content-type'), 'image/png');
  assert.equal(readiness.status, 503);
  assert.equal((await readiness.json()).data.ready, false);
});

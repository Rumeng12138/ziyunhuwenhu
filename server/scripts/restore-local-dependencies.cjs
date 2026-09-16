// Restore junctions omitted when a pnpm workspace was copied without links.
// Uses only the existing local package map; never downloads or replaces files.
const fs = require('node:fs');
const path = require('node:path');
const modules = path.resolve(__dirname, '../node_modules');
const root = path.dirname(modules);
const { packages } = JSON.parse(fs.readFileSync(path.join(modules, '.package-map.json'), 'utf8'));
function inside(value) {
  const relative = path.relative(root, value);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Package path outside workspace');
  return value;
}
let created = 0;
for (const entry of Object.values(packages)) {
  const directory = inside(path.resolve(modules, entry.url));
  if (!fs.existsSync(directory)) continue; // Optional packages for other platforms.
  for (const [name, key] of Object.entries(entry.dependencies || {})) {
    const target = inside(path.resolve(modules, packages[key].url));
    if (!fs.existsSync(target)) continue;
    const link = inside(path.join(directory, 'node_modules', name));
    if (fs.existsSync(link)) continue;
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    created++;
  }
}
console.log(`Restored ${created} local dependency links.`);

// Inlines everything in public/ into src/files.generated.js so the Worker serves the app itself.
// This is how the live "cranebrain" Worker on Cloudflare was bundled.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const root = new URL('../public/', import.meta.url).pathname;
const walk = d => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
const files = {};
for (const p of walk(root)) {
  const key = '/' + relative(root, p), ct = TYPES[extname(p)] || 'application/octet-stream';
  files[key] = ct.startsWith('image/') ? { ct, b: readFileSync(p).toString('base64') } : { ct, t: readFileSync(p, 'utf8') };
}
writeFileSync(new URL('../src/files.generated.js', import.meta.url), 'export default ' + JSON.stringify(files) + ';\n');
console.log('bundled', Object.keys(files).length, 'files');

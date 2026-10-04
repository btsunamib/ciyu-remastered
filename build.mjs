import { mkdir, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true }); await mkdir('dist');
for (const filename of ['index.html', 'style.css', 'app.js', 'core.js', 'storage.js', 'audio.js', 'icons.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', '.nojekyll']) await cp(filename, `dist/${filename}`, { recursive: true });
process.stdout.write('静态网站已生成：dist/\n');

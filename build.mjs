import { mkdir, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true }); await mkdir('dist');
for (const filename of ['index.html', 'style.css', 'customize.css', 'lap.css', 'lap-core.js', 'lap-ai.js', 'lap-ui.js', 'ai.js', 'ai-ui.js', 'study-chat.js', 'appearance.js', 'app.js', 'core.js', 'storage.js', 'audio.js', 'icons.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', '.nojekyll']) await cp(filename, `dist/${filename}`, { recursive: true });
process.stdout.write('静态网站已生成：dist/\n');

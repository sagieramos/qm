import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(projectRoot, 'dist');
const [databaseSource, applicationSource, baseStyles, improvementStyles, htmlSource] = await Promise.all([
  readFile(join(projectRoot, 'db.js'), 'utf8'),
  readFile(join(projectRoot, 'app.js'), 'utf8'),
  readFile(join(projectRoot, 'styles.css'), 'utf8'),
  readFile(join(projectRoot, 'improvement.css'), 'utf8'),
  readFile(join(projectRoot, 'index.html'), 'utf8')
]);

// db.js is a classic script loaded before app.js. Keep both in one esbuild
// entry so the app and database share a scope without initializing twice.
// The app's HTML handlers need explicit window exports once bundled in an IIFE.
const handlerNames = new Set();
for (const source of [htmlSource, applicationSource]) {
  for (const match of source.matchAll(/\bon(?:click|change|input|submit|keydown)\s*=\s*["']\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    handlerNames.add(match[1]);
  }
}
const exposureSource = `\nObject.assign(window,{${[...handlerNames].join(',')}});`;
const javascriptSource = `${databaseSource}\n;\n${applicationSource}${exposureSource}`;
const [javascriptBuild, stylesheetBuild] = await Promise.all([
  esbuild.build({
    stdin: { contents: javascriptSource, resolveDir: projectRoot, sourcefile: 'db.js + app.js' },
    bundle: true,
    write: false,
    outfile: 'app.min.js',
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'none'
  }),
  esbuild.build({
    stdin: { contents: `${baseStyles}\n${improvementStyles}`, resolveDir: projectRoot, sourcefile: 'styles.css + improvement.css', loader: 'css' },
    bundle: true,
    write: false,
    outfile: 'styles.min.css',
    platform: 'browser',
    target: ['chrome90', 'firefox90', 'safari15'],
    minify: true,
    legalComments: 'none'
  })
]);
const javascript = javascriptBuild.outputFiles.find(file => file.path.endsWith('.js'));
const stylesheet = stylesheetBuild.outputFiles.find(file => file.path.endsWith('.css'));

function fingerprint(contents) {
  return createHash('sha256').update(contents).digest('hex').slice(0, 12);
}

const javascriptName = `app.min.${fingerprint(javascript.contents)}.js`;
const stylesheetName = `styles.min.${fingerprint(stylesheet.contents)}.css`;

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(join(outputDirectory, javascriptName), javascript.contents),
  writeFile(join(outputDirectory, stylesheetName), stylesheet.contents),
  // Stable aliases are available for tooling that expects the documented names.
  writeFile(join(outputDirectory, 'app.min.js'), javascript.contents),
  writeFile(join(outputDirectory, 'styles.min.css'), stylesheet.contents)
]);

const productionHtml = htmlSource
  .replace(
    '<link rel="stylesheet" href="styles.css">\n<link rel="stylesheet" href="improvement.css">',
    `<link rel="stylesheet" href="${stylesheetName}">`
  )
  .replace(
    '<script src="db.js"></script>\n<script src="app.js"></script>',
    `<script src="${javascriptName}"></script>`
  );

if (productionHtml === htmlSource) {
  throw new Error('Could not replace the source asset references in index.html.');
}

await writeFile(join(outputDirectory, 'index.html'), productionHtml);

const sourceJavaScriptBytes = Buffer.byteLength(databaseSource) + Buffer.byteLength(applicationSource);
const sourceCssBytes = Buffer.byteLength(baseStyles) + Buffer.byteLength(improvementStyles);
console.log(`Production build written to ${resolve(outputDirectory)}`);
console.log(`JavaScript: ${javascriptName} (${javascript.contents.byteLength} bytes; sources ${sourceJavaScriptBytes} bytes)`);
console.log(`CSS:        ${stylesheetName} (${stylesheet.contents.byteLength} bytes; sources ${sourceCssBytes} bytes)`);

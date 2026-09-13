/**
 * Builds the interface translation packs.
 *
 * The strings this app renders are known ahead of time, so paying Gemini for them while someone
 * waits is a waste of the only thing that matters here — how long the page takes to change
 * language. This harvests those strings from the client source, translates each language once,
 * and writes a pack the browser can load as a static file. At runtime only text the codebase
 * never wrote (merchant names, categories, advisor answers) still needs the model.
 *
 *   node scripts/build-i18n-packs.mjs            # every language but English
 *   node scripts/build-i18n-packs.mjs es fr      # just these
 *
 * Needs the API running (PORT, default 3000) with GEMINI_API_KEY configured.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_DIRS = [path.join(ROOT, 'client/src')];
const OUT_DIR = path.join(ROOT, 'client/public/i18n');
const API = `http://localhost:${process.env.PORT ?? 3000}`;
/** The request cap; the harvest is chunked to fit. */
const CHUNK = 180;

/** Props whose value is read by a person rather than by the browser. */
const TEXT_PROPS = [
  'title', 'placeholder', 'aria-label', 'alt', 'label', 'allLabel', 'description',
  'subtitle', 'eyebrow', 'headline', 'subheadline', 'body', 'heading', 'hint', 'summary',
];

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

/** The same rule the runtime translator applies, so the pack and the page agree on what counts. */
function translatable(text) {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 600) return false;
  if (!/\p{L}\p{L}/u.test(trimmed)) return false;
  // Class names, ids, import paths and enum values are not prose.
  if (/^[a-z0-9_-]+$/.test(trimmed)) return false;
  if (/^[A-Z0-9_]+$/.test(trimmed)) return false;
  if (/[{}<>]|\.\.\/|https?:\/\//.test(trimmed)) return false;
  // Type signatures and code fragments that slipped through the JSX and object-literal sweeps.
  if (/=>|\)\s*:|;\s*$|\bPromise\b|\bReactNode\b/.test(trimmed)) return false;
  // Tailwind utilities, media queries, css values, hashes and mime types.
  if (/^(?:sm|md|lg|xl|2xl|hover|focus|active|group|peer|dark|motion):/.test(trimmed)) return false;
  if (/^[a-z0-9]+(?:[-:/][a-z0-9.[\]()%]+)+$/i.test(trimmed) && !/\s/.test(trimmed)) return false;
  if (/\b(?:rounded|flex|grid|text|bg|ring|border|px|py|mt|mb|gap|size|w-|h-|min-|max-)-/.test(trimmed)) return false;
  if (/^[A-Za-z]+\/[A-Za-z]/.test(trimmed)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return false;            // hex colours
  if (/^[./#]/.test(trimmed)) return false;                        // routes, selectors, relative paths
  if (/^[('`]|[,(]\s*$|['"`]\s*[,)]/.test(trimmed)) return false; // fragments of code, not sentences
  if (/\b(?:const|let|return|function|await|async|import|export|typeof)\b/.test(trimmed)) return false;
  if (/^(?:[a-z-]+:)?[a-z-]+(?:\s+[a-z0-9:/[\]().-]+)+$/.test(trimmed) && !/\s[A-Z]/.test(trimmed)) return false;
  return true;
}

function harvest(source) {
  const found = new Set();

  // JSX text between tags, up to the next tag or expression: `<h2>Invoice history {count}</h2>`
  // is as common as a tag holding nothing but text.
  for (const [, text] of source.matchAll(/>([^<>{}\n]{2,600})[<{]/g)) found.add(text.trim());

  // Reader-facing props and object literals that carry copy.
  const props = new RegExp(`(?:${TEXT_PROPS.join('|')})\\s*[=:]\\s*(?:\\{\\s*)?['"\`]([^'"\`]{2,600})['"\`]`, 'g');
  for (const [, text] of source.matchAll(props)) found.add(text.trim());

  // The advisor's own dictionaries are plain string values in an object.
  for (const [, text] of source.matchAll(/^\s*[a-zA-Z]+:\s*'([^']{4,600})',?$/gm)) found.add(text.trim());

  // Everything else quoted in a component: table headings in an array, option labels, toasts.
  // `translatable` throws out the class names and identifiers this sweeps up with them.
  for (const [, text] of source.matchAll(/'([^'\\\n]{2,600})'/g)) found.add(text.trim());
  for (const [, text] of source.matchAll(/"([^"\\\n]{2,600})"/g)) found.add(text.trim());

  return [...found].filter(translatable);
}

const post = (language, strings) =>
  fetch(`${API}/api/i18n/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, strings }),
  });

async function translate(language, strings) {
  const out = {};
  for (let i = 0; i < strings.length; i += CHUNK) {
    const chunk = strings.slice(i, i + CHUNK);
    // The route rate-limits per IP, and a full rebuild is exactly the caller it is limiting.
    // Waiting out the window is correct here: this runs at build time, not while anyone waits.
    let res = await post(language, chunk);
    for (let attempt = 0; res.status === 429 && attempt < 5; attempt += 1) {
      process.stdout.write(`  ${language}: rate limited, waiting 30s\r`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      res = await post(language, chunk);
    }
    if (!res.ok) throw new Error(`${language}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    Object.assign(out, body.translations);
    process.stdout.write(`  ${language}: ${Object.keys(out).length}/${strings.length}\r`);
  }
  return out;
}

const shared = await readFile(path.join(ROOT, 'shared/copilot.ts'), 'utf8');
const codes = shared.match(/export const ADVISOR_LANGUAGES = \[([^\]]+)\]/)?.[1] ?? '';
const ALL = [...codes.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((c) => c !== 'en');
const wanted = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ALL;

const files = (await Promise.all(SOURCE_DIRS.map(sourceFiles))).flat();
const strings = [...new Set((await Promise.all(files.map((f) => readFile(f, 'utf8')))).flatMap(harvest))].sort();
console.log(`Harvested ${strings.length} strings from ${files.length} files`);

await mkdir(OUT_DIR, { recursive: true });
for (const language of wanted) {
  const started = Date.now();
  const translations = await translate(language, strings);
  await writeFile(path.join(OUT_DIR, `${language}.json`), `${JSON.stringify(translations, null, 0)}\n`);
  console.log(`  ${language}: ${Object.keys(translations).length} strings in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
console.log(`Packs written to ${path.relative(ROOT, OUT_DIR)}`);

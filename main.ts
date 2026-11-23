// NEON DRIFT — make.fun video-on-X entry (Node 22, standard library only).
//
// The entry is the X post itself: a short video of an AI agent building this
// tiny browser game from one prompt. This program does exactly one job — it
// copies POST.json from the repository root to /output/POST.json, where the
// gate reads the post's address. Nothing it writes is scored; the house reads
// the post's views and interactions from X directly.
//
// Run it locally the same way the grader does:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const POST_FILE = 'POST.json';

const source = join(BOT_DIR, POST_FILE);
const target = join(OUTPUT_DIR, POST_FILE);

mkdirSync(OUTPUT_DIR, { recursive: true });

try {
  const info = statSync(source);
  if (info.size > 16384) {
    console.error(`${POST_FILE} is ${info.size} bytes, over the 16384-byte cap.`);
    process.exit(1);
  }
  // The gate reads url out of POST.json, so refuse a file that is not
  // a JSON object carrying a string url instead of copying a broken one.
  const parsed = JSON.parse(readFileSync(source, 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { url?: unknown }).url !== 'string') {
    console.error(`${POST_FILE} must be a JSON object with a string "url".`);
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log(`Copied ${POST_FILE} (${info.size} bytes) to ${target}.`);
} catch (err) {
  console.error(`Could not copy ${POST_FILE} from ${BOT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}

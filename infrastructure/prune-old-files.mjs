// Removes files from the site bucket that the build just deployed no longer has, once they have been out of
// use for a while (RETAIN_DAYS, a week by default).
//
// They are not deleted the moment a deploy replaces them, as `aws s3 sync --delete` would: a tab opened before
// the deploy still asks for the old build's files by their hashed names (the game itself is only fetched when
// the player presses New game or Continue), and with them gone it could not start. Keeping them a week lets
// every open tab carry on with the build it has until it reloads onto the new one (src/core/update.ts).
//
// Every deploy uploads the whole of dist/ again, so an object's LastModified is the last deploy that still
// had it: older than the cutoff and missing from dist/ means it has been unused for at least that long.
//
//   node infrastructure/prune-old-files.mjs <bucket> [dist dir]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [bucket, dist = 'dist'] = process.argv.slice(2);
if (!bucket) {
  console.error('usage: node infrastructure/prune-old-files.mjs <bucket> [dist dir]');
  process.exit(2);
}
// Without the build to compare with, everything would look unused.
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`prune: ${dist}/index.html is missing; not pruning anything`);
  process.exit(1);
}

const days = Number(process.env.RETAIN_DAYS ?? 7);
if (!Number.isFinite(days) || days < 0) {
  console.error(`prune: RETAIN_DAYS must be a number of days, not "${process.env.RETAIN_DAYS}"`);
  process.exit(2);
}
const cutoff = Date.now() - days * 86_400_000;

const aws = (...args) => execFileSync('aws', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// The CLI follows the pages itself and merges them into one listing.
const listing = JSON.parse(aws('s3api', 'list-objects-v2', '--bucket', bucket, '--output', 'json') || '{}');
const stale = (listing.Contents ?? []).filter(({ Key, LastModified }) => Date.parse(LastModified) < cutoff && !existsSync(join(dist, Key))).map(({ Key }) => Key);

console.log(`prune: ${stale.length} file(s) in s3://${bucket} unused for over ${days} day(s)`);
// delete-objects takes up to a thousand keys at a time.
for (let i = 0; i < stale.length; i += 1000) {
  const batch = stale.slice(i, i + 1000);
  for (const key of batch) console.log(`prune: deleting ${key}`);
  aws('s3api', 'delete-objects', '--bucket', bucket, '--delete', JSON.stringify({ Objects: batch.map((Key) => ({ Key })), Quiet: true }));
}

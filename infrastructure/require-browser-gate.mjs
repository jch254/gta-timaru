// Browser CI runs without AWS credentials. Do not upload until its push workflow
// (both browser jobs) succeeds for the exact source revision built by CodeBuild.
import { setTimeout as sleep } from 'node:timers/promises';

const sha = process.env.CODEBUILD_RESOLVED_SOURCE_VERSION;
if (!/^[a-f\d]{40}$/.test(sha ?? '')) throw new Error('Missing full resolved GitHub commit SHA');
const url = `https://api.github.com/repos/jch254/the-03/actions/runs?event=push&head_sha=${sha}&per_page=100`;
const deadline = Date.now() + 22 * 60_000;
for (;;) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`Cannot verify browser gate: GitHub returned ${res.status}`);
  const { workflow_runs } = await res.json();
  const run = workflow_runs.find(r => r.path === '.github/workflows/production-browser.yml' && r.head_sha === sha && r.event === 'push');
  if (run?.status === 'completed') {
    if (run.conclusion !== 'success') throw new Error(`Browser gate ${run.conclusion}: ${run.html_url}`);
    console.log(`Browser gate passed: ${run.html_url}`);
    break;
  }
  if (Date.now() >= deadline) throw new Error(`Timed out waiting for browser gate at ${sha}`);
  console.log(`Waiting for browser gate at ${sha}: ${run?.status ?? 'not yet scheduled'}`);
  await sleep(60_000);
}

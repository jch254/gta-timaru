# Infrastructure

Terraform for hosting the game on AWS (private S3 served by CloudFront), with
TLS via ACM, DNS in Cloudflare, and deployment by AWS CodeBuild. It is composed
from the shared [`terraform-modules`](https://github.com/jch254/terraform-modules)
(`web-app`, `acm-dns-validated-certificate`, `cloudflare-dns-records`,
`ssm-parameter-placeholder`, `codebuild-project`, `codebuild-terraform-role`)
at tag `1.19.1`. The site follows the same layout as
`discogs-market-monitor/frontend`; the game owns its whole zone, `03.quest`,
so the zone's records and its Cloudflare token are kept here the way
`jch254dotcom` and `603dotnz` keep theirs.

## What is managed

**Static hosting** (`web-app` module)
- Private S3 bucket (BucketOwnerEnforced, no public access) holding `dist/`
- CloudFront distribution reading the bucket via Origin Access Control (OAC)
- No SPA fallback: the game is one page with relative asset paths, so a missing
  file fails as a missing file

**TLS certificate** (`acm-dns-validated-certificate` module)
- ACM certificate for the site domain, issued in **us-east-1** (required by
  CloudFront), DNS-validated via Cloudflare records

**Cloudflare DNS** (`cloudflare-dns-records` module)
- `CNAME` from the site domain → the CloudFront distribution domain, plus the
  ACM validation records
- The site record is **DNS-only** (`proxied = false`): CloudFront terminates
  TLS and does the caching, and the deploy's CloudFront invalidation would not
  reach a Cloudflare cache in front of it. To proxy it anyway, purge
  Cloudflare's cache on each deploy too, and any CSP on the zone needs
  `'wasm-unsafe-eval'` in `script-src` (the physics WebAssembly) and `blob:` in
  `img-src` and `connect-src` (the character models carry their textures inside
  the file), or the game does not start.
- Served from the apex, `www` is a proxied placeholder record (`AAAA 100::`,
  no origin) and a Single Redirect rule (`cloudflare_ruleset`, phase
  `http_request_dynamic_redirect`) sends it to `https://03.quest` with the path
  and query kept. One hostname serves the game, so saves (browser storage is
  per hostname) are never split between two.
- Set `manage_dns = false` to skip the site record and the www redirect

**Old addresses** (`cloudflare-dns-records` module and `cloudflare_ruleset`)
- The game's earlier addresses (`old_site_subdomains` in the `old_site_zone`
  Cloudflare zone) are proxied placeholder records, and a Single Redirect rule
  there sends them (301) to `https://03.quest` with the path and query kept, so
  old links still land on the game. An empty list turns it off.
- That rule is the old zone's Single Redirect ruleset, and a zone has only one,
  so any other redirect wanted in that zone (by `603dotnz` or another app) has
  to be added here or the ruleset moved to the repo that owns the zone.
- Saves made at an old address stay with it: the redirect takes players to the
  game, not their browser storage.

**Cloudflare API token** (`ssm-parameter-placeholder` module)
- `/03-quest/cloudflare-api-token`, created by Terraform with a placeholder
  value that is then overwritten by hand (Terraform ignores the value after
  that). `buildspec.yml` loads it as `CLOUDFLARE_API_TOKEN`, so Terraform never
  takes the token as a variable.
- The token needs **Zone DNS Edit** and **Single Redirect Edit** on `03.quest`
  and on `old_site_zone` (for the old-address redirect).

**CodeBuild deployment** (`codebuild-project` + `codebuild-terraform-role`)
- On a push to `main`: runs the unit tests (a red suite aborts before anything
  deploys), applies this Terraform, runs `pnpm run build`, `aws s3 sync`s
  `dist/` to the bucket, uploads `version.json` last, prunes old files, then
  invalidates the CloudFront distribution (see `buildspec.yml` in the repo root)
- `version.json` (the build's commit and time) is what running games read to
  learn a new build is out and offer a reload (`src/core/update.ts`). It is
  uploaded with `no-cache`, after every file it stands for.
- The sync does not `--delete`: a tab opened before a deploy still asks for the
  old build's hashed files. `prune-old-files.mjs` removes files the new build
  no longer has once they have been unused for a week (`RETAIN_DAYS`). A
  failed prune does not fail the deploy; the next one tries again.
- `CLOUDFLARE_API_TOKEN` is read from SSM Parameter Store by `buildspec.yml`
- Build results go to the shared-platform build notifier

## State

Remote state is stored in S3. The bucket/key/region are supplied via
`-backend-config` in `deploy-infrastructure.bash`:

- bucket: `jch254-terraform-remote-state` (override with `REMOTE_STATE_BUCKET`)
- key: `timmaz-hard-prod-infrastructure` (override with `TF_STATE_KEY`)
- region: `ap-southeast-4` (override with `REMOTE_STATE_REGION`)

## Variables worth checking

| Variable | Default | Description |
|---|---|---|
| `domain` | `03.quest` | Cloudflare zone the game is served from |
| `site_subdomain` | `""` | Subdomain to serve from (`""` serves at the apex) |
| `bucket_name` | `timmaz-hard` | S3 bucket name; must be globally unique |
| `aws_region` | `ap-southeast-2` | Region for the bucket and the CodeBuild project |
| `codebuild_webhook_branch` | `main` | Branch whose pushes deploy |
| `manage_dns` | `true` | Whether Terraform manages the Cloudflare DNS records and the redirects |
| `old_site_subdomains` | `["the-03", "timmaz-hard"]` | Old subdomains of `old_site_zone` redirected to the site |
| `cloudflare_api_token_parameter_name` | `/03-quest/cloudflare-api-token` | SSM parameter holding the Cloudflare token |

With the defaults the game is served at `https://03.quest`, the apex of the
`03.quest` zone. Cloudflare answers a CNAME on the apex with flattened A/AAAA
records, so the record can stay DNS-only there too.
Changing `domain` or `site_subdomain` replaces the ACM certificate and the
Cloudflare records and re-points the CloudFront alias; add the old name to the
old-address redirect if links to it should keep working. A new `domain` has to be an active zone in the
Cloudflare account that the token can edit: the plan reads the zone first, so
a token that cannot see it fails the build before anything changes.

The game has been renamed twice since these resources were created (THE 03,
then 03 Quest, now at `03.quest`), but the state key, bucket and CodeBuild
project still carry the
original `timmaz-hard` slug: changing any of them creates new resources rather
than renaming the old ones, so moving those to the new slug is a deliberate
migration, not a find-and-replace.

## First deploy

The CodeBuild project is created by this same Terraform, so the first apply is
run by hand.

```bash
# Authenticate with AWS (requires access to the S3 state bucket).
aws sso login  # or export AWS_* env vars

# Export a Cloudflare token with Zone DNS Edit and Single Redirect Edit on the zone.
export CLOUDFLARE_API_TOKEN="..."

bash ./infrastructure/deploy-infrastructure.bash
```

Then overwrite the placeholder token parameter that apply created, so CodeBuild
can read the real one:

```bash
aws ssm put-parameter \
  --region ap-southeast-2 \
  --name /03-quest/cloudflare-api-token \
  --type SecureString \
  --value "$CLOUDFLARE_API_TOKEN" \
  --overwrite
```

That first apply creates the bucket, distribution, certificate, DNS records,
www redirect, token parameter and the CodeBuild project, but uploads nothing.
Push to `main` (or start the `timmaz-hard` build in CodeBuild) to build the
game and publish it.

If `codebuild_webhook_enabled` is `true`, the AWS account must already have
CodeBuild GitHub source credentials configured so AWS can create the webhook.

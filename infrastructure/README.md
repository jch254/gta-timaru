# Infrastructure

Terraform for hosting the game on AWS (private S3 served by CloudFront), with
TLS via ACM, DNS in Cloudflare, and deployment by AWS CodeBuild. It is composed
from the shared [`terraform-modules`](https://github.com/jch254/terraform-modules)
(`web-app`, `acm-dns-validated-certificate`, `cloudflare-dns-records`,
`codebuild-project`, `codebuild-terraform-role`) at tag `1.19.1`, and follows
the same layout as `discogs-market-monitor/frontend`.

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
- The record is **DNS-only** (`proxied = false`) and has to stay that way. If
  it is proxied through a zone whose response-header ruleset sends
  `script-src 'self'`, browsers refuse to compile the physics WebAssembly and
  the game does not start. To proxy it anyway, that policy needs
  `'wasm-unsafe-eval'` in `script-src` and `blob:` in `img-src` and
  `connect-src` (the character models carry their textures inside the file).
- Set `manage_dns = false` to skip the site record

**CodeBuild deployment** (`codebuild-project` + `codebuild-terraform-role`)
- On a push to `main`: runs the unit tests (a red suite aborts before anything
  deploys), applies this Terraform, runs `pnpm run build`, `aws s3 sync`s
  `dist/` to the bucket, then invalidates the CloudFront distribution (see
  `buildspec.yml` in the repo root)
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
| `domain` | `603.nz` | Cloudflare zone the game is served from |
| `site_subdomain` | `the-03` | Subdomain to serve from (`""` serves at the apex) |
| `bucket_name` | `timmaz-hard` | S3 bucket name; must be globally unique |
| `aws_region` | `ap-southeast-2` | Region for the bucket and the CodeBuild project |
| `codebuild_webhook_branch` | `main` | Branch whose pushes deploy |
| `manage_dns` | `true` | Whether Terraform manages the Cloudflare DNS record |

With the defaults the game is served at `https://the-03.603.nz`. Changing
`site_subdomain` replaces the ACM certificate and the Cloudflare CNAME and
re-points the CloudFront alias; nothing answers at the old subdomain
afterwards.

The game has been renamed THE 03 and the subdomain has moved with it, but the
other live resources (state key, bucket, SSM parameter, CodeBuild project)
still carry the previous `timmaz-hard` slug: changing any of them creates new
resources rather than renaming the old ones, so moving those to the new slug
is a deliberate migration, not a find-and-replace.

## First deploy

The CodeBuild project is created by this same Terraform, so the first apply is
run by hand.

```bash
# Authenticate with AWS (requires access to the S3 state bucket).
aws sso login  # or export AWS_* env vars

# Export a Cloudflare token with Zone DNS Edit permission for the zone.
export CLOUDFLARE_API_TOKEN="..."

bash ./infrastructure/deploy-infrastructure.bash
```

Then store the token once so CodeBuild can read it:

```bash
aws ssm put-parameter \
  --region ap-southeast-2 \
  --name /timmaz-hard/cloudflare-api-token \
  --type SecureString \
  --value "$CLOUDFLARE_API_TOKEN" \
  --overwrite
```

That first apply creates the bucket, distribution, certificate, DNS records and
the CodeBuild project, but uploads nothing. Push to `main` (or start the
`timmaz-hard` build in CodeBuild) to build the game and publish it.

If `codebuild_webhook_enabled` is `true`, the AWS account must already have
CodeBuild GitHub source credentials configured so AWS can create the webhook.

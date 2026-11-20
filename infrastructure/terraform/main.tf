data "aws_caller_identity" "current" {}

data "cloudflare_zone" "zone" {
  filter = {
    name = var.domain
  }
}

locals {
  site_domain     = var.site_subdomain == "" ? var.domain : "${var.site_subdomain}.${var.domain}"
  dns_record_name = var.site_subdomain == "" ? var.domain : var.site_subdomain
  # Served from the apex, www answers too, as a redirect to the apex.
  www_redirect = var.manage_dns && var.site_subdomain == ""
  # The game's old addresses, each redirected to the site.
  old_site_redirect = var.manage_dns && length(var.old_site_subdomains) > 0
  old_site_hosts    = [for name in var.old_site_subdomains : "${name}.${var.old_site_zone}"]

  # shared-platform deploys one build-notifier core (SNS topic + formatter
  # Lambda) per CI region, because EventBridge can only invoke a same-region
  # Lambda. This project's CodeBuild runs in var.aws_region, so subscribe to
  # the formatter shared-platform deploys there.
  build_notifier_lambda_function_arn = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.build_notifier_lambda_function_name}"
}

# --- Cloudflare API token (SSM placeholder; the real value is put by hand) -----

module "cloudflare_api_token_parameter" {
  source = "github.com/jch254/terraform-modules//ssm-parameter-placeholder?ref=1.19.1"

  name        = var.cloudflare_api_token_parameter_name
  description = "Cloudflare API token for ${var.domain} Terraform"
}

# --- ACM certificate (us-east-1, required by CloudFront) -----------------------

module "certificate" {
  source = "github.com/jch254/terraform-modules//acm-dns-validated-certificate?ref=1.19.1"

  providers = {
    aws = aws.us_east_1
  }

  domain_name = local.site_domain
}

# Names the certificate covers. Kept as static config so the validation
# records' for_each keys are known at plan time (the ACM record names/values
# are only known after apply). Extend if subject_alternative_names are added.
locals {
  certificate_domains = [local.site_domain]
}

# DNS validation records for the cert, created in Cloudflare. Keyed by domain
# name (static); the ACM-computed record name/type/value are looked up per key.
module "certificate_validation_records" {
  source = "github.com/jch254/terraform-modules//cloudflare-dns-records?ref=1.19.1"

  zone_id = data.cloudflare_zone.zone.id
  records = {
    for domain in local.certificate_domains : domain => {
      # ACM gives the record name with a trailing dot and Cloudflare stores it
      # without one; left as is, every plan wants to rename the record.
      name = trimsuffix(one([
        for dvo in module.certificate.domain_validation_options :
        dvo.resource_record_name if dvo.domain_name == domain
      ]), ".")
      type = one([
        for dvo in module.certificate.domain_validation_options :
        dvo.resource_record_type if dvo.domain_name == domain
      ])
      content = one([
        for dvo in module.certificate.domain_validation_options :
        dvo.resource_record_value if dvo.domain_name == domain
      ])
      ttl = 1
    }
  }
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn         = module.certificate.arn
  validation_record_fqdns = [for record in module.certificate_validation_records.records : record.name]
}

# --- Static hosting: CloudFront + private S3 (OAC) ----------------------------

module "site" {
  source = "github.com/jch254/terraform-modules//web-app?ref=1.19.1"

  bucket_name = var.bucket_name
  dns_names   = [local.site_domain]
  acm_arn     = aws_acm_certificate_validation.site.certificate_arn

  # The game is one page with relative asset paths and no client-side routes,
  # so a missing file should fail as a missing file rather than come back as
  # index.html with a 200.
  spa_fallback_path = ""
}

# --- Cloudflare DNS: CNAME the site to the CloudFront distribution ------------
# At the apex (site_subdomain = "") this is still a CNAME: Cloudflare flattens
# a CNAME on the zone apex into A/AAAA answers, proxied or not.

module "site_dns" {
  count  = var.manage_dns ? 1 : 0
  source = "github.com/jch254/terraform-modules//cloudflare-dns-records?ref=1.19.1"

  zone_id = data.cloudflare_zone.zone.id
  records = {
    site = {
      name = local.dns_record_name
      type = "CNAME"
      # CloudFront serves TLS via the ACM cert and does the caching, so
      # Cloudflare is DNS-only here. Proxied, Cloudflare's cache would sit in
      # front of CloudFront's without the deploy's invalidation reaching it,
      # and any CSP on the zone would need 'wasm-unsafe-eval' in script-src and
      # blob: in img-src and connect-src or the game does not start.
      content = module.site.cloudfront_domain_name
      proxied = false
    }
  }
}

# --- www: redirected to the apex at Cloudflare's edge -------------------------
# One hostname serves the game, so a save made on one is never missing on the
# other (browser storage is kept per hostname).

module "www_dns" {
  count  = local.www_redirect ? 1 : 0
  source = "github.com/jch254/terraform-modules//cloudflare-dns-records?ref=1.19.1"

  zone_id = data.cloudflare_zone.zone.id
  records = {
    www = {
      name = "www"
      type = "AAAA"
      # Nothing is served from www: the record only exists so Cloudflare answers
      # it and the rule below can redirect. 100:: is the discard prefix used for
      # proxied records that have no origin.
      content = "100::"
      proxied = true
    }
  }
}

resource "cloudflare_ruleset" "www_redirect" {
  count = local.www_redirect ? 1 : 0

  zone_id     = data.cloudflare_zone.zone.id
  name        = "default"
  description = "Redirect www to the apex"
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [
    {
      ref         = "www_to_apex"
      description = "www.${var.domain} to https://${var.domain}, keeping the path and query"
      expression  = "(http.host eq \"www.${var.domain}\")"
      action      = "redirect"

      action_parameters = {
        from_value = {
          status_code           = 301
          preserve_query_string = true
          target_url = {
            expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
          }
        }
      }
    },
  ]
}

# --- Old addresses: redirected to the site at Cloudflare's edge ---------------
# The game used to be served from subdomains of 603.nz. Links to them still land
# on the game. This owns 603.nz's Single Redirect ruleset (a zone has one), so
# redirects for anything else in 603.nz would have to be added here too.

data "cloudflare_zone" "old_site" {
  count = local.old_site_redirect ? 1 : 0

  filter = {
    name = var.old_site_zone
  }
}

module "old_site_dns" {
  count  = local.old_site_redirect ? 1 : 0
  source = "github.com/jch254/terraform-modules//cloudflare-dns-records?ref=1.19.1"

  zone_id = data.cloudflare_zone.old_site[0].id
  records = {
    for name in var.old_site_subdomains : name => {
      name = name
      type = "AAAA"
      # A placeholder, like www's: the rule below answers before any origin.
      content = "100::"
      proxied = true
    }
  }
}

resource "cloudflare_ruleset" "old_site_redirect" {
  count = local.old_site_redirect ? 1 : 0

  zone_id     = data.cloudflare_zone.old_site[0].id
  name        = "default"
  description = "Redirect the game's old addresses to https://${local.site_domain}"
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [
    {
      ref         = "old_site_to_site"
      description = "${join(", ", local.old_site_hosts)} to https://${local.site_domain}, keeping the path and query"
      expression  = "(http.host in {${join(" ", [for host in local.old_site_hosts : "\"${host}\""])}})"
      action      = "redirect"

      action_parameters = {
        from_value = {
          status_code           = 301
          preserve_query_string = true
          target_url = {
            expression = "concat(\"https://${local.site_domain}\", http.request.uri.path)"
          }
        }
      }
    },
  ]
}

# --- CodeBuild: build the game, sync dist/ to S3, invalidate CloudFront -------


module "codebuild_project" {
  source = "github.com/jch254/terraform-modules//codebuild-project?ref=1.19.1"

  name               = var.codebuild_project_name
  description        = "Build 03 Quest and deploy it to S3/CloudFront"
  codebuild_role_arn = aws_iam_role.publisher.arn
  build_docker_image = var.codebuild_build_docker_image
  build_docker_tag   = var.codebuild_build_docker_tag
  build_compute_type = var.codebuild_build_compute_type
  source_type        = "GITHUB"
  source_location    = var.codebuild_source_location
  buildspec          = var.codebuild_buildspec
  git_clone_depth    = 1

  environment_variables = [
    { name = "AWS_DEFAULT_REGION", value = var.aws_region },
    { name = "SITE_BUCKET", value = module.site.s3_bucket_id },
    { name = "DISTRIBUTION_ID", value = module.site.cloudfront_distribution_id },
  ]

  webhook_enabled = var.codebuild_webhook_enabled
  webhook_filter_groups = [[
    { type = "EVENT", pattern = "PUSH" },
    { type = "HEAD_REF", pattern = "refs/heads/${var.codebuild_webhook_branch}" },
  ]]

  # Email build success/failure notifications via the shared-platform notifier.
  build_notifier_lambda_function_arn = local.build_notifier_lambda_function_arn
  build_notifier_app_url             = "https://${local.site_domain}"
  build_notifier_github_repo_url     = trimsuffix(var.codebuild_source_location, ".git")
}

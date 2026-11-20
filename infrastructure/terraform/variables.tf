variable "aws_region" {
  description = "AWS region for the S3 site bucket and CodeBuild deploy project."
  type        = string
  default     = "ap-southeast-2"
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
  default     = "prod"
}

variable "domain" {
  description = "Cloudflare zone name (apex domain) the game is served from."
  type        = string
  default     = "03.quest"
}

variable "site_subdomain" {
  description = "Subdomain to serve the game from. Empty string serves at the apex."
  type        = string
  default     = ""
}

variable "old_site_zone" {
  description = "Cloudflare zone holding the game's old addresses."
  type        = string
  default     = "603.nz"
}

variable "old_site_subdomains" {
  description = "Old addresses of the game in old_site_zone, each redirected (301) to the site. Empty list turns the redirect off."
  type        = list(string)
  default     = ["the-03"]
}

variable "bucket_name" {
  description = "Name of the S3 bucket that hosts the built game. Must be globally unique."
  type        = string
  default     = "timmaz-hard"
}

variable "cloudflare_api_token_parameter_name" {
  description = "SSM Parameter Store name containing the Cloudflare API token. Terraform creates it as a placeholder; the real token is put by hand."
  type        = string
  default     = "/03-quest/cloudflare-api-token"
}

variable "manage_dns" {
  description = "Whether Terraform manages the Cloudflare DNS records for the game (and, served from the apex, the www redirect)."
  type        = bool
  default     = true
}

variable "codebuild_project_name" {
  description = "Name of the CodeBuild project that builds the game and deploys it to S3."
  type        = string
  default     = "timmaz-hard"
}

variable "codebuild_source_location" {
  description = "GitHub repository URL used by the CodeBuild source."
  type        = string
  default     = "https://github.com/jch254/the-03.git"
}

variable "codebuild_buildspec" {
  description = "Path to the CodeBuild buildspec file (relative to repo root)."
  type        = string
  default     = "buildspec.yml"
}

variable "codebuild_build_compute_type" {
  description = "CodeBuild compute type."
  type        = string
  default     = "BUILD_GENERAL1_SMALL"
}

variable "codebuild_build_docker_image" {
  description = "Docker image used as the CodeBuild build environment."
  type        = string
  default     = "jch254/docker-node-terraform-aws"
}

variable "codebuild_build_docker_tag" {
  description = "Docker image tag used as the CodeBuild build environment."
  type        = string
  default     = "22.x-docker"
}

variable "codebuild_webhook_enabled" {
  description = "Whether CodeBuild deploys automatically on pushes to the source branch."
  type        = bool
  default     = true
}

variable "codebuild_webhook_branch" {
  description = "Git branch that triggers CodeBuild webhook builds."
  type        = string
  default     = "main"
}

variable "build_notifier_lambda_function_name" {
  description = "Name of the shared-platform build notification formatter Lambda in this project's region."
  type        = string
  default     = "shared-platform-ap-southeast-2-build-notification-formatter"
}

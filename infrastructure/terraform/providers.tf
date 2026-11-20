provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "timmaz-hard"
    }
  }
}

# CloudFront requires its ACM certificate in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "timmaz-hard"
    }
  }
}

# The infrastructure operator supplies CLOUDFLARE_API_TOKEN; CodeBuild never reads it.
provider "cloudflare" {}

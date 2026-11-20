locals {
  publisher_project_arn = "arn:aws:codebuild:${var.aws_region}:${data.aws_caller_identity.current.account_id}:project/${var.codebuild_project_name}"
  publisher_log_group   = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/codebuild/${var.codebuild_project_name}"
}

resource "aws_iam_role" "publisher" {
  name = "${var.codebuild_project_name}-publisher"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { ArnEquals = { "aws:SourceArn" = local.publisher_project_arn } }
    }]
  })
}

resource "aws_iam_role_policy" "publish" {
  name = "publish-game"
  role = aws_iam_role.publisher.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = module.site.s3_bucket_arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:DeleteObject"]
        Resource = "${module.site.s3_bucket_arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = module.site.cloudfront_distribution_arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${local.publisher_log_group}:log-stream:*"
      },
    ]
  })
}

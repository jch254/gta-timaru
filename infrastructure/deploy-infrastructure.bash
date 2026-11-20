#!/bin/bash

# Operator only. Leave the saved plan for review before a separate apply.
set -eu

: "${CLOUDFLARE_API_TOKEN:?export the infrastructure operator token first}"

cd "$(dirname "$0")/terraform"

terraform init \
  -reconfigure \
  -backend-config "bucket=${REMOTE_STATE_BUCKET:-jch254-terraform-remote-state}" \
  -backend-config "key=${TF_STATE_KEY:-timmaz-hard-prod-infrastructure}" \
  -backend-config "region=${REMOTE_STATE_REGION:-ap-southeast-4}" \
  -get=true

terraform plan -out main.tfplan
echo 'After review, run: terraform -chdir=infrastructure/terraform apply main.tfplan'

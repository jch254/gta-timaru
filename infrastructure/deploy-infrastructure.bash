#!/bin/bash

# Stop at the first failing command. This has to be set here rather than on the
# shebang line: buildspec.yml runs this file as `bash ./…`, which ignores the
# shebang's flags, and a failed plan would otherwise go unnoticed while the
# build carried on and reported success.
set -ex

echo Deploying THE 03 infrastructure via Terraform...

cd "$(dirname "$0")/terraform"

terraform init \
  -reconfigure \
  -backend-config "bucket=${REMOTE_STATE_BUCKET:-jch254-terraform-remote-state}" \
  -backend-config "key=${TF_STATE_KEY:-timmaz-hard-prod-infrastructure}" \
  -backend-config "region=${REMOTE_STATE_REGION:-ap-southeast-4}" \
  -get=true

terraform plan -out main.tfplan
terraform apply -auto-approve main.tfplan

echo Finished deploying THE 03 infrastructure

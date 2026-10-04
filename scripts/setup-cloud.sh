#!/usr/bin/env bash
# Run in Google Cloud Shell after reviewing the target project and permissions.
# No billing account, service-account key, compute instance or bucket is created.
set -euo pipefail

if [[ $# != 4 ]]; then
  echo 'Usage: bash scripts/setup-cloud.sh PROJECT_ID OWNER/REPOSITORY REPOSITORY_ID OWNER_ID' >&2
  exit 2
fi
project_id=$1
repository=$2
repository_id=$3
owner_id=$4
[[ "$project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || exit 2
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 2
[[ "$repository_id" =~ ^[0-9]+$ && "$owner_id" =~ ^[0-9]+$ ]] || exit 2

project_number=$(gcloud projects describe "$project_id" --format='value(projectNumber)')
[[ "$project_number" =~ ^[0-9]+$ ]] || exit 1
service_account="cws-publisher@${project_id}.iam.gserviceaccount.com"
pool=github
provider=github
workflow_ref="${repository}/.github/workflows/ci.yml@refs/heads/main"
condition="assertion.repository_id == '${repository_id}' && assertion.repository_owner_id == '${owner_id}' && assertion.repository == '${repository}' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == '${workflow_ref}' && (assertion.event_name == 'push' || assertion.event_name == 'workflow_dispatch')"

printf 'Project: %s (%s)\nRepository: %s\nWorkflow: %s\n' "$project_id" "$project_number" "$repository" "$workflow_ref"
gcloud services enable chromewebstore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$project_id"

if ! gcloud iam service-accounts describe "$service_account" --project="$project_id" >/dev/null 2>&1; then
  gcloud iam service-accounts create cws-publisher --project="$project_id" --display-name='Chrome Web Store publisher'
fi
if ! gcloud iam workload-identity-pools describe "$pool" --location=global --project="$project_id" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" --location=global --project="$project_id" --display-name='GitHub release workflow'
fi
provider_args=(--location=global --project="$project_id" --workload-identity-pool="$pool"
  --issuer-uri='https://token.actions.githubusercontent.com'
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id'
  --attribute-condition="$condition")
if gcloud iam workload-identity-pools providers describe "$provider" --location=global --project="$project_id" --workload-identity-pool="$pool" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$provider" "${provider_args[@]}"
else
  gcloud iam workload-identity-pools providers create-oidc "$provider" "${provider_args[@]}" --display-name='GitHub Actions main only'
fi

gcloud iam service-accounts add-iam-policy-binding "$service_account" --project="$project_id" \
  --role='roles/iam.workloadIdentityUser' \
  --member="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${pool}/attribute.repository_id/${repository_id}"

printf '\nGitHub repository variables:\nGCP_SERVICE_ACCOUNT=%s\nGCP_WORKLOAD_IDENTITY_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\nCWS_SUBMIT_ENABLED=false\n' "$service_account" "$project_number" "$pool" "$provider"
echo 'Link this service account in the Chrome Web Store publisher settings separately. Do not enable automatic submission until the first listing has been reviewed.'

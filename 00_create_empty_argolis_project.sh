#!/usr/bin/env bash
# ==============================================================================
# Step 0: Create a Clean Empty Argolis Project for Knowledge Catalog Hands-on Lab
# Organization: hyunseungl.altostrat.com (organizations/868285378220)
# Billing Account: 0131AF-8681F3-79A814
# ==============================================================================
set -euo pipefail

ORG_ID="868285378220"
BILLING_ACCOUNT="0131AF-8681F3-79A814"
PROJECT_ID="${1:-kc-handson-lab-01}"
PROJECT_NAME="KCHandsonLab"

echo "=================================================================="
echo "🚀 Provisioning Clean Argolis Project for Hands-on Verification"
echo "  • Organization ID : ${ORG_ID} (hyunseungl.altostrat.com)"
echo "  • Billing Account : ${BILLING_ACCOUNT}"
echo "  • Project ID      : ${PROJECT_ID}"
echo "=================================================================="

echo "=== [1/4] Creating project '${PROJECT_ID}' under Org ${ORG_ID} ==="
if gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  echo " -> Project '${PROJECT_ID}' already exists."
else
  gcloud projects create "${PROJECT_ID}" \
    --name="${PROJECT_NAME}" \
    --organization="${ORG_ID}"
  echo " -> Created project '${PROJECT_ID}'."
fi

echo "=== [2/4] Linking Billing Account ${BILLING_ACCOUNT} ==="
gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}"

echo "=== [3/4] Setting default gcloud project to '${PROJECT_ID}' ==="
gcloud config set project "${PROJECT_ID}"

echo "=== [4/4] Enabling base APIs for Console access ==="
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  iam.googleapis.com \
  orgpolicy.googleapis.com \
  bigquery.googleapis.com \
  dataplex.googleapis.com \
  datacatalog.googleapis.com \
  discoveryengine.googleapis.com \
  aiplatform.googleapis.com \
  --project="${PROJECT_ID}"

echo ""
echo "✅ Empty Argolis project '${PROJECT_ID}' is ready!"
echo "------------------------------------------------------------------"
echo "🔗 Direct Console Links for Hands-on Tasks:"
echo "  • Task 1 (BigQuery Studio)    : https://console.cloud.google.com/bigquery?project=${PROJECT_ID}"
echo "  • Task 2 (Knowledge Catalog)  : https://console.cloud.google.com/dataplex/glossaries?project=${PROJECT_ID}"
echo "  • Task 3 (Gemini Enterprise)  : https://console.cloud.google.com/gemini-enterprise/data-stores?project=${PROJECT_ID}"
echo "------------------------------------------------------------------"

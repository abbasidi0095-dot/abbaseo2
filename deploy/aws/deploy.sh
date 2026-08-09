#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-abbaseo-app}"
REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=== AbbaSeo AWS CloudFormation Deployment ==="
echo "Stack Name: ${STACK_NAME}"
echo "Region:     ${REGION}"

# Load DATAFORSEO_API_KEY from .env if present
DATAFORSEO_KEY="${DATAFORSEO_API_KEY:-}"
if [ -z "${DATAFORSEO_KEY}" ] && [ -f "${ROOT_DIR}/.env" ]; then
  DATAFORSEO_KEY="$(grep -E '^DATAFORSEO_API_KEY=' "${ROOT_DIR}/.env" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
fi

OPENROUTER_KEY="${OPENROUTER_API_KEY:-}"
if [ -z "${OPENROUTER_KEY}" ] && [ -f "${ROOT_DIR}/.env" ]; then
  OPENROUTER_KEY="$(grep -E '^OPENROUTER_API_KEY=' "${ROOT_DIR}/.env" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
fi

PARAMETER_OVERRIDES=(
  "InstanceType=t3.medium"
)

if [ -n "${DATAFORSEO_KEY}" ]; then
  PARAMETER_OVERRIDES+=("DataForSeoApiKey=${DATAFORSEO_KEY}")
fi

if [ -n "${OPENROUTER_KEY}" ]; then
  PARAMETER_OVERRIDES+=("OpenRouterApiKey=${OPENROUTER_KEY}")
fi

echo "Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file "${SCRIPT_DIR}/cloudformation.yaml" \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --parameter-overrides "${PARAMETER_OVERRIDES[@]}" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

echo ""
echo "=== Deployment Completed ==="
echo "Fetching stack outputs..."

aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
  --output table

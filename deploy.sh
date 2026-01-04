#!/bin/bash

# SC Market Image Lambda Deployment Script

set -e

echo "🚀 Starting deployment..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if function name is provided
if [ -z "$1" ]; then
    echo "❌ Please provide the Lambda function name as an argument"
    echo "Usage: ./deploy.sh <function-name>"
    exit 1
fi

FUNCTION_NAME=$1

echo "📦 Building project..."
npm run build

echo "📦 Packaging Lambda..."
npm run package

echo "🚀 Deploying to AWS Lambda..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://dist/lambda.zip

echo "✅ Deployment completed successfully!"
echo "📝 Function: $FUNCTION_NAME"
echo "🔗 Check AWS Console for deployment status"

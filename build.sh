#!/bin/bash

# SC Market Image Lambda - Build Script
# This script builds and packages the Lambda function for deployment

set -e  # Exit on any error

echo "🚀 Starting Lambda build process..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Step 1: Clean previous builds
print_status "Cleaning previous builds..."
rm -rf dist/
rm -f lambda.zip

# Step 2: Build TypeScript
print_status "Building TypeScript code..."
yarn && yarn build
if [ $? -eq 0 ]; then
    print_success "TypeScript build completed"
else
    print_error "TypeScript build failed"
    exit 1
fi

# Step 3: Prepare dist folder for packaging
print_status "Preparing dist folder for packaging..."
cd dist

# Copy package.json for dependency installation
cp ../package.json .

# Step 4: Install production dependencies for Linux (Lambda runtime)
print_status "Installing Linux-compatible production dependencies..."

# Install all dependencies except Sharp first
npm install --production --ignore-scripts

# Step 4b: Remove any existing Sharp installation and install Linux version
print_status "Installing Sharp with Linux binaries..."
rm -rf node_modules/sharp node_modules/@img/sharp*

# Install Sharp specifically for Linux using modern npm flags
npm install sharp --production --os=linux --cpu=x64

if [ $? -eq 0 ]; then
    print_success "Dependencies installed successfully"
else
    print_error "Dependency installation failed"
    exit 1
fi

# Step 5: Create deployment package
print_status "Creating Lambda deployment package..."
zip -r ../lambda.zip . > /dev/null
if [ $? -eq 0 ]; then
    print_success "Lambda package created successfully"
else
    print_error "Failed to create Lambda package"
    exit 1
fi

# Step 6: Clean up dist folder
print_status "Cleaning up build artifacts..."
cd ..
rm -rf dist/node_modules dist/package.json dist/yarn.lock

# Step 7: Verify package contents
print_status "Verifying package contents..."
PACKAGE_SIZE=$(du -h lambda.zip | cut -f1)
FILE_COUNT=$(unzip -l lambda.zip | grep -c "^\s*[0-9]")

print_success "Build completed successfully!"
echo "📦 Package: lambda.zip"
echo "📏 Size: $PACKAGE_SIZE"
echo "📁 Files: $FILE_COUNT"
echo ""
echo "Ready for deployment with: yarn deploy"

# SC Market Image Lambda

An AWS Lambda function that processes image uploads with content moderation using Amazon Rekognition and uploads approved images to Backblaze B2.

## Features

1. **Image Upload**: Accepts base64-encoded images via API Gateway
2. **Format Support**: Supports WebP, JPG, and PNG formats with intelligent conversion
3. **Content Moderation**: Uses Amazon Rekognition to detect inappropriate content (PNG/JPG only)
4. **Smart Format Conversion**: Automatically converts WebP to PNG for scanning, then to WebP for storage
5. **Backblaze Upload**: Automatically uploads approved images to Backblaze B2 storage
6. **Modular Architecture**: Separate modules for logging, Rekognition client, image processing, and configuration
7. **Structured Logging**: Winston-based logging with structured JSON output

## Supported Image Formats

The Lambda function supports three image formats with intelligent processing:

- **WebP**: Converted to PNG for scanning, original WebP preserved for final storage
- **JPG/JPEG**: Scanned as-is, converted to WebP for final storage
- **PNG**: Scanned as-is, converted to WebP for final storage

Any other format will be rejected with a clear error message.

## File Size Limits

- **Maximum file size**: 2MB
- **Supported formats**: WebP, JPG, PNG
- Images exceeding 2MB will be rejected with a `FILE_TOO_LARGE` error

## Image Processing Workflow

```
Input Image → Format Validation → Processing → Moderation → Final Storage
     ↓              ↓              ↓           ↓           ↓
  WebP/JPG/PNG   Validate    Convert if     Scan with    Upload to
                 Format      needed         Rekognition  Backblaze
```

### Processing Rules:

- **WebP files**: Convert to PNG for scanning (Rekognition compatibility), keep original WebP for storage
- **JPG/PNG files**: Scan in original format, convert to WebP for final storage (better compression)
- **Unsupported formats**: Rejected immediately with error response

## WebP Compression Optimization

The Lambda function now includes advanced WebP compression settings for optimal file sizes and quality:

### Compression Settings

- **Quality**: Configurable from 1-100 (default: 80 for new conversions, 85 for re-compression)
- **Effort Level**: 0-6 compression effort (default: 4 for balanced speed/compression)
- **Smart Subsampling**: Enabled by default for better photo compression
- **Preset**: Optimized for photographic content (`photo` preset)
- **Lossless Options**: Configurable lossless and near-lossless compression

### Environment Variables for Compression

```bash
# WebP Compression Configuration
WEBP_QUALITY=80              # Quality: 1-100 (default: 80)
WEBP_EFFORT=4                # Compression effort: 0-6 (default: 4)
WEBP_PRESET=photo            # Preset: default, photo, picture, drawing, icon, text
WEBP_SMART_SUBSAMPLE=true    # Smart subsampling: true/false (default: true)
WEBP_LOSSLESS=false          # Lossless compression: true/false (default: false)
WEBP_NEAR_LOSSLESS=false     # Near-lossless: true/false (default: false)
```

### Compression Benefits

- **File Size Reduction**: Typically 25-35% smaller than equivalent quality JPEG
- **Quality Preservation**: Maintains visual quality while reducing bandwidth
- **Web Optimization**: Ideal for web delivery and CDN distribution
- **Configurable**: Adjust settings based on your quality vs. file size requirements

### Compression Strategies

1. **New Conversions (JPG/PNG → WebP)**: Uses `WEBP_QUALITY` setting for optimal balance
2. **WebP Re-compression**: Slightly higher quality cap (90) to prevent quality degradation
3. **Adaptive Compression**: Different settings for different content types via presets

## Project Structure

```
src/
├── index.ts              # Main Lambda handler
├── logger.ts             # Winston logger configuration
├── clients/
│   └── rekognition.ts   # AWS Rekognition client (PNG/JPG only)
└── utils/
    └── image_processor.ts # Image format validation and conversion
```

## Prerequisites

- AWS CLI configured with appropriate permissions
- Yarn package manager
- Node.js 18+ and TypeScript
- AWS S3 bucket for temporary storage
- Amazon Rekognition access
- Backblaze B2 account and bucket

## Setup

1. **Install dependencies:**

   ```bash
   yarn install
   ```

2. **Build the project:**

   ```bash
   yarn build
   ```

3. **Package for deployment:**
   ```bash
   yarn package
   ```

## Environment Variables

The Lambda function requires the following environment variables:

```bash
# AWS Configuration
S3_ACCESS_KEY_ID=your-s3-access-key-id
S3_SECRET_ACCESS_KEY=your-s3-secret-access-key
S3_BUCKET_NAME=your-s3-bucket-name

# Backblaze B2 Configuration
B2_KEY_ID=your-backblaze-key-id
B2_APP_KEY=your-backblaze-app-key
B2_BUCKET_NAME=your-backblaze-bucket-name

# CDN Configuration
CDN_URL=https://your-cdn-domain.com

# WebP Compression Configuration (Optional - uses defaults if not set)
WEBP_QUALITY=80              # Quality: 1-100 (default: 80)
WEBP_EFFORT=4                # Compression effort: 0-6 (default: 4)
WEBP_PRESET=photo            # Preset: default, photo, picture, drawing, icon, text
WEBP_SMART_SUBSAMPLE=true    # Smart subsampling: true/false (default: true)
WEBP_LOSSLESS=false          # Lossless compression: true/false (default: false)
WEBP_NEAR_LOSSLESS=false     # Near-lossless: true/false (default: false)

# Application Configuration
NODE_ENV=production
LOG_LEVEL=info
```

## AWS IAM Permissions

Your Lambda execution role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::your-temp-s3-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": ["rekognition:DetectModerationLabels"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## API Usage

### Request Format

```json
{
  "imageData": "base64-encoded-image-string",
  "filename": "example.jpg",
  "contentType": "image/jpeg"
}
```

**Supported content types:**

- `image/webp`
- `image/jpeg` or `image/jpg`
- `image/png`

### Response Format

**Success Response:**

```json
{
  "success": true,
  "message": "Image successfully processed and uploaded",
  "data": {
    "filename": "example.webp",
    "backblazeUrl": "https://your-cdn-domain.com/example.webp",
    "originalFormat": "jpg",
    "finalFormat": "webp",
    "moderationResult": {
      "isAppropriate": true,
      "confidence": 100
    }
  }
}
```

**Error Response (Unsupported Format):**

```json
{
  "success": false,
  "message": "Unsupported image format: image/gif. Only webp, jpg, and png are supported.",
  "error": "UNSUPPORTED_FORMAT"
}
```

**Error Response (Moderation Failed):**

```json
{
  "success": false,
  "message": "Image failed moderation checks",
  "error": "MODERATION_FAILED",
  "data": {
    "moderationLabels": ["Explicit Nudity"],
    "confidence": 85.5
  }
}
```

**Error Response (File Too Large):**

```json
{
  "success": false,
  "message": "Image file size too large: 3.5MB. Maximum allowed size is 2MB.",
  "error": "FILE_TOO_LARGE",
  "data": {
    "sizeBytes": 3670016,
    "maxSizeBytes": 2097152,
    "sizeMB": "3.50"
  }
}
```

## Content Moderation

The function checks for the following inappropriate content types:

- Explicit Nudity
- Violence
- Visually Disturbing
- Hate Symbols
- Gambling
- Drugs
- Tobacco
- Alcohol
- Rude Gestures
- Adult Content

Images are rejected if any of these labels are detected with 70%+ confidence.

## Development

- **Build:** `yarn build`
- **Package:** `yarn package` (creates `lambda.zip` with files at root level)
- **Deploy:** `yarn deploy`
- **Format:** `yarn format`
- **Format Check:** `yarn format:check`
- **Lint:** `yarn lint`

## Architecture

```
API Gateway → Lambda → Image Processor → Rekognition Client → S3 (temp) → Rekognition → Backblaze B2 (S3 API)
     ↓           ↓           ↓              ↓              ↓           ↓           ↓
   Request   Process   Convert WebP→PNG   Scan PNG/JPG   Upload   Analyze   Upload via S3 API
```

## Error Handling

The function handles various error scenarios:

- Invalid input validation
- File size validation (2MB limit)
- Unsupported image formats
- Image conversion failures
- S3 upload failures
- Rekognition API errors
- Backblaze upload failures
- Network timeouts

## Security Considerations

- Images are temporarily stored in S3 with automatic cleanup
- Rekognition moderation uses AWS's content safety algorithms
- Backblaze credentials are stored as environment variables
- All API responses are sanitized
- Structured logging for better monitoring and debugging
- Format validation prevents malicious file uploads

## Monitoring

Enable CloudWatch logging to monitor:

- Function execution times
- Error rates
- Moderation results
- Upload success/failure rates
- Image format conversion statistics
- Structured log data for better insights

## Code Quality

- **Prettier**: Automatic code formatting
- **TypeScript**: Type safety and better development experience
- **Modular Design**: Separated concerns for maintainability
- **Functional Approach**: Simple functions instead of complex class hierarchies
- **Structured Logging**: Winston logger with JSON output
- **Image Processing**: Sharp library for efficient format conversion
- **Backblaze Integration**: Uses AWS S3-compatible API for seamless uploads

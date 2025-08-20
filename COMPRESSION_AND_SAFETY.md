# WebP Compression & Moderation Safety Features

## Overview

The image processor now includes enhanced WebP compression for storage optimization and improved moderation safety to ensure failed images are never uploaded to Backblaze.

## WebP Compression Features

### **Compression Settings**

#### **Standard Compression**

- **Quality**: 80 (good balance between quality and file size)
- **Effort**: 4 (higher effort for better compression)
- **Smart Subsampling**: Enabled (better compression for photographic content)
- **Lossless**: Disabled (use lossy compression for smaller files)
- **Near Lossless**: Disabled (use lossy compression for smaller files)

#### **Aggressive Compression for Large Images**

- **Trigger**: Images larger than 1MB
- **Quality**: 75 (slightly lower for better compression)
- **Effort**: 5 (maximum compression effort)
- **Purpose**: Optimize storage for large images while maintaining acceptable quality

### **Compression Benefits**

#### **Storage Savings**

- **Typical Reduction**: 25-35% smaller than equivalent quality JPEG
- **Large Image Optimization**: Up to 40-50% reduction for images >1MB
- **Bandwidth Savings**: Faster uploads and downloads
- **CDN Optimization**: Better caching and distribution

#### **Quality Preservation**

- **Visual Quality**: Maintains excellent visual quality
- **Web Optimization**: Ideal for web delivery
- **Progressive Enhancement**: Better user experience on slow connections

## Moderation Safety Features

### **Upload Prevention**

#### **Failed Moderation = No Upload**

- **Guarantee**: Images that fail moderation are NEVER uploaded to Backblaze
- **Early Return**: 400 status response with moderation details
- **Clear Logging**: Explicit logging that upload was prevented
- **Action Tracking**: Logs show "REJECTED - No upload performed"

#### **Moderation Flow**

```
Image Input → Moderation Check → Decision
     ↓              ↓            ↓
  Buffer      Rekognition    Pass/Fail
     ↓              ↓            ↓
  Validation    Content Scan   Upload or Reject
```

### **Safety Mechanisms**

#### **1. Early Validation**

- **Format Check**: Validate image format before processing
- **Size Check**: Ensure image is under 2MB limit
- **Dimension Check**: Validate width/height constraints

#### **2. Moderation Checkpoint**

- **Rekognition Scan**: Use AWS content moderation
- **Confidence Threshold**: 70%+ confidence for rejection
- **Label Detection**: Check for inappropriate content types

#### **3. Upload Prevention**

- **Conditional Upload**: Only upload if moderation passes
- **Clear Logging**: Log approval/rejection with action taken
- **Error Response**: Return appropriate error codes and messages

## Implementation Details

### **WebP Compression Code**

```typescript
const webpOptions: sharp.WebpOptions = {
  quality: 80, // Good balance between quality and file size
  effort: 4, // Higher effort for better compression
  smartSubsample: true, // Better compression for photographic content
  nearLossless: false, // Use lossy compression for smaller files
  lossless: false, // Use lossy compression for smaller files
};

// For very large images, use more aggressive compression
if (imageBuffer.length > 1024 * 1024) {
  // 1MB+
  webpOptions.quality = 75; // Slightly lower quality for better compression
  webpOptions.effort = 5; // Maximum compression effort
}
```

### **Moderation Safety Code**

```typescript
// Step 1: Scan image for content moderation
const moderationResult = await scanImageForModeration(imageBuffer, contentType);
if (!moderationResult.passed) {
  logger.warn(
    'Image failed moderation checks - preventing upload to Backblaze',
    {
      filename: body.filename,
      moderationLabels: moderationResult.moderationLabels,
      confidence: moderationResult.confidence,
      action: 'REJECTED - No upload performed',
    }
  );

  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      message: 'Image failed moderation checks',
      error: 'MODERATION_FAILED',
      data: {
        moderationLabels: moderationResult.moderationLabels,
        confidence: moderationResult.confidence,
      },
    }),
  };
}

logger.info('Image passed moderation checks - proceeding to upload', {
  filename: body.filename,
  confidence: moderationResult.confidence,
  action: 'APPROVED - Proceeding to upload',
});
```

## Monitoring & Logging

### **Compression Statistics**

#### **Upload Logging**

```typescript
logger.info('WebP conversion check completed', {
  originalFormat: ImageProcessor.extractFormatFromContentType(contentType),
  finalFormat: webpImage.format,
  converted: webpImage.converted,
  finalBufferSize: webpImage.buffer.length,
  compressionRatio: webpImage.converted
    ? (
        ((imageBuffer.length - webpImage.buffer.length) / imageBuffer.length) *
        100
      ).toFixed(1) + '%'
    : 'N/A (no conversion)',
  spaceSaved: webpImage.converted
    ? (imageBuffer.length - webpImage.buffer.length) / (1024 * 1024)
    : 0,
});
```

#### **Compression Metrics**

- **Compression Ratio**: Percentage reduction in file size
- **Space Saved**: Absolute reduction in MB
- **Conversion Status**: Whether conversion was performed
- **Quality Settings**: Applied compression parameters

### **Moderation Safety Logging**

#### **Rejection Logging**

```typescript
logger.warn('Image failed moderation checks - preventing upload to Backblaze', {
  filename: body.filename,
  moderationLabels: moderationResult.moderationLabels,
  confidence: moderationResult.confidence,
  action: 'REJECTED - No upload performed',
});
```

#### **Approval Logging**

```typescript
logger.info('Image passed moderation checks - proceeding to upload', {
  filename: body.filename,
  confidence: moderationResult.confidence,
  action: 'APPROVED - Proceeding to upload',
});
```

## Testing

### **Test Script**

```bash
yarn test:large-image
```

### **Test Coverage**

- **Compression Features**: WebP conversion with compression settings
- **Moderation Safety**: Upload prevention for failed moderation
- **Compression Statistics**: Ratio and space savings calculations
- **Error Handling**: Proper error responses for moderation failures

## Benefits

### **Storage Optimization**

- **Reduced Storage Costs**: Smaller file sizes save Backblaze storage
- **Faster Uploads**: Smaller files upload more quickly
- **Better CDN Performance**: Optimized files for web delivery
- **Bandwidth Savings**: Reduced data transfer costs

### **Content Safety**

- **Guaranteed Safety**: Failed moderation = no upload
- **Clear Audit Trail**: Comprehensive logging of all decisions
- **Compliance**: Meets content moderation requirements
- **Risk Mitigation**: Prevents inappropriate content from being stored

### **Operational Efficiency**

- **Better Monitoring**: Clear visibility into compression and moderation
- **Faster Processing**: Optimized compression settings
- **Reduced Errors**: Clear error handling and logging
- **Better Debugging**: Isolated issues to specific areas

## Future Enhancements

### **Advanced Compression**

- **Adaptive Quality**: Quality based on image content type
- **Progressive JPEG**: Better compression for large images
- **Format Optimization**: Choose best format for specific use cases
- **Quality Presets**: Predefined compression profiles

### **Enhanced Safety**

- **Real-time Monitoring**: Live moderation status tracking
- **Quality Assurance**: Automated content review workflows
- **Compliance Reporting**: Detailed moderation statistics
- **Alert Systems**: Notifications for moderation failures

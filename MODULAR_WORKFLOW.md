# Modular Image Processing Workflow

## Overview

The image processor has been refactored to use a modular approach with separate methods for scanning and uploading, making the code cleaner and more maintainable.

## Architecture

### **Separation of Concerns**

- **`scanImageForModeration()`**: Handles content moderation with Rekognition
- **`uploadImageToBackblaze()`**: Handles image upload and format conversion
- **`ImageProcessor`**: Utility class for format conversions and validation

### **Workflow Flow**

```
Input Image → Validation → Moderation → Upload → Success
     ↓           ↓           ↓         ↓        ↓
  Buffer    Format/Size   Rekognition  WebP   Backblaze
```

## Core Methods

### **1. `scanImageForModeration(imageBuffer, contentType)`**

- **Purpose**: Scan image for inappropriate content using Amazon Rekognition
- **Process**:
  1. Convert to PNG if necessary for Rekognition compatibility
  2. Scan with Rekognition API
  3. Return moderation results
- **Returns**: `{ passed: boolean, moderationLabels: string[], confidence: number }`

### **2. `uploadImageToBackblaze(imageBuffer, filename, contentType)`**

- **Purpose**: Upload approved image to Backblaze B2 storage
- **Process**:
  1. Convert to WebP if necessary for final storage
  2. Upload to Backblaze using S3-compatible API
  3. Return public CDN URL
- **Returns**: `string` (public URL)

## ImageProcessor Methods

### **`convertToRekognitionCompatible(imageBuffer, contentType)`**

- **Purpose**: Ensure image is compatible with Rekognition (PNG/JPG)
- **Behavior**:
  - **If PNG/JPG**: Return original buffer (no conversion)
  - **If WebP/Other**: Convert to PNG
- **Returns**: `{ buffer: Buffer, format: string, converted: boolean }`

### **`convertToWebPIfNeeded(imageBuffer, contentType)`**

- **Purpose**: Ensure image is in WebP format for final storage
- **Behavior**:
  - **If WebP**: Return original buffer (no conversion)
  - **If JPG/PNG/Other**: Convert to WebP
- **Returns**: `{ buffer: Buffer, format: string, converted: boolean }`

## Benefits of Modular Approach

### **1. Clear Separation**

- **Moderation Logic**: Isolated in `scanImageForModeration()`
- **Upload Logic**: Isolated in `uploadImageToBackblaze()`
- **Conversion Logic**: Isolated in `ImageProcessor` utility methods

### **2. Better Error Handling**

- **Specific Error Context**: Each method handles its own errors
- **Clear Error Flow**: Errors bubble up with proper context
- **Easier Debugging**: Issues can be isolated to specific methods

### **3. Memory Efficiency**

- **No Multiple Buffers**: Only one format in memory at a time
- **Immediate Cleanup**: Intermediate buffers are discarded after use
- **24MB Lambda Optimized**: Designed for memory constraints

### **4. Maintainability**

- **Single Responsibility**: Each method has one clear purpose
- **Easier Testing**: Individual methods can be tested in isolation
- **Better Code Organization**: Logic is grouped by functionality

## Code Example

```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  // ... validation logic ...

  // Step 1: Scan image for content moderation
  const moderationResult = await scanImageForModeration(
    imageBuffer,
    contentType
  );
  if (!moderationResult.passed) {
    return moderationErrorResponse(moderationResult);
  }

  // Step 2: Upload approved image to Backblaze
  const finalFilename = body.filename.replace(/\.[^/.]+$/, '.webp');
  const backblazeUrl = await uploadImageToBackblaze(
    imageBuffer,
    finalFilename,
    contentType
  );

  return successResponse(backblazeUrl);
};
```

## Error Handling

### **Moderation Errors**

- **Content Violations**: Return 400 with moderation details
- **Rekognition Failures**: Log and rethrow for proper error handling
- **Conversion Failures**: Specific error types for format issues

### **Upload Errors**

- **WebP Conversion Failures**: Memory or format-related errors
- **Backblaze Upload Failures**: Network or credential issues
- **Format Validation**: Early rejection of invalid images

## Memory Management

### **Buffer Lifecycle**

```
Original Buffer → PNG (if needed) → Rekognition → Discard
     ↓
WebP (if needed) → Backblaze → Success
```

### **Optimization Features**

- **No Duplicate Buffers**: Each format exists only when needed
- **Immediate Cleanup**: Intermediate buffers freed after use
- **Smart Conversions**: Only convert when necessary

## Testing

### **Test Script**

```bash
yarn test:large-image
```

### **Test Coverage**

- **Format Validation**: Supported formats and size limits
- **Rekognition Compatibility**: PNG conversion when needed
- **WebP Conversion**: Format conversion for final storage
- **Error Handling**: Various failure scenarios

## Future Enhancements

### **Stream Processing**

- **Large Image Support**: Process images in chunks
- **Memory Monitoring**: Real-time memory usage tracking
- **Progressive Processing**: Handle very large images

### **Advanced Features**

- **Adaptive Quality**: Quality based on image content
- **Format Optimization**: Choose best format for specific use cases
- **Caching**: Cache converted formats for repeated use

## Migration from Sequential Workflow

### **What Changed**

- **Removed**: Complex `ProcessedImage` interface
- **Simplified**: Single-purpose conversion methods
- **Modularized**: Separated moderation and upload logic

### **What Stayed the Same**

- **Memory Optimization**: 24MB Lambda constraints
- **Error Handling**: Comprehensive error types
- **Format Support**: WebP, JPG, PNG support
- **Validation**: File size and format validation

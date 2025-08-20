# Sequential Image Processing Workflow

## Overview

The image processor has been refactored to use a sequential, memory-efficient workflow that processes one format at a time and discards intermediate buffers to save memory.

## Workflow Steps

### 1. **Image Input & Validation**

- Accept image buffer and content type
- Validate format (WebP, JPG, JPEG, PNG)
- Check file size (2MB limit)
- Validate dimensions (8K×8K max)

### 2. **Rekognition Compatibility Check**

- **If PNG/JPG**: Use original (already compatible)
- **If WebP**: Convert to PNG for Rekognition scanning
- **If other**: Convert to PNG for Rekognition scanning

### 3. **Content Moderation**

- Scan with Amazon Rekognition using compatible format
- **Pass**: Continue to final processing
- **Fail**: Return moderation error, stop processing

### 4. **Final Format Conversion**

- **If WebP**: Use original (no conversion needed)
- **If JPG/PNG**: Convert to WebP for storage
- **If other**: Convert to WebP for storage

### 5. **Upload & Cleanup**

- Upload final WebP version to Backblaze
- Discard intermediate buffers (PNG versions)
- Return success response

## Memory Management

### **Sequential Processing**

- Only one image format in memory at a time
- Intermediate buffers are discarded immediately
- No simultaneous storage of multiple formats

### **Buffer Lifecycle**

```
Original Buffer → PNG (if needed) → Rekognition → Discard PNG
     ↓
WebP Conversion → Final Buffer → Upload → Success
```

### **Memory Optimization**

- **24MB Lambda Constraint**: Optimized for memory efficiency
- **Buffer Reuse**: Original buffer reused when possible
- **Garbage Collection**: Intermediate buffers freed immediately

## Code Changes

### **Interface Simplification**

```typescript
// Before: Complex interface with multiple buffers
interface ProcessedImage {
  originalFormat: string;
  scanFormat: string;
  finalFormat: string;
  scanBuffer: Buffer;
  finalBuffer: Buffer;
}

// After: Simple interface with single final buffer
interface ProcessedImage {
  originalFormat: string;
  finalFormat: string;
  finalBuffer: Buffer;
}
```

### **Workflow Methods**

```typescript
// Main sequential processing
static async processImage(imageBuffer: Buffer, contentType: string): Promise<ProcessedImage>

// Rekognition compatibility
static async getRekognitionCompatibleImage(imageBuffer: Buffer, originalFormat: string): Promise<{ buffer: Buffer; format: string }>

// Format conversions
private static async convertToPNG(imageBuffer: Buffer): Promise<Buffer>
private static async convertToWebP(imageBuffer: Buffer): Promise<Buffer>
```

## Benefits

### **Memory Efficiency**

- **Reduced Memory Usage**: No multiple formats in memory
- **Better Garbage Collection**: Immediate buffer cleanup
- **24MB Optimization**: Designed for Lambda constraints

### **Simplified Logic**

- **Clearer Workflow**: Step-by-step processing
- **Easier Debugging**: Each step is isolated
- **Better Error Handling**: Specific error types for each step

### **Performance**

- **Faster Processing**: No unnecessary format conversions
- **Reduced I/O**: Only convert when needed
- **Better Caching**: Sharp instances reused efficiently

## Usage Example

```typescript
// Process image sequentially
const processedImage = await ImageProcessor.processImage(
  imageBuffer,
  contentType
);

// Get Rekognition compatible version for moderation
const rekognitionImage = await ImageProcessor.getRekognitionCompatibleImage(
  imageBuffer,
  processedImage.originalFormat
);

// Use for moderation
const moderationResult = await RekognitionClient.scanImageForModeration(
  rekognitionImage.buffer,
  ImageProcessor.getMimeType(rekognitionImage.format)
);

// Upload final version
await uploadToBackblaze(
  processedImage.finalBuffer,
  filename,
  ImageProcessor.getMimeType(processedImage.finalFormat)
);
```

## Error Handling

### **Error Types**

- **`InvalidImageFormat`**: Invalid or corrupted image data
- **`MemoryLimitExceeded`**: Image too large for 24MB constraint
- **`ImageTooLarge`**: Dimensions exceed 8K×8K limit
- **`ProcessingFailure`**: General processing errors

### **Error Flow**

1. **Format Validation**: Early rejection of invalid images
2. **Memory Check**: Prevent processing of oversized images
3. **Conversion Errors**: Specific errors for each conversion step
4. **Moderation Errors**: Clear feedback on content issues

## Testing

### **Test Script**

```bash
yarn test:large-image
```

### **Test Coverage**

- Format validation
- Size validation
- Sequential processing workflow
- Rekognition compatibility
- Error handling

## Future Enhancements

- **Stream Processing**: For very large images
- **Progressive JPEG**: Better memory management
- **Adaptive Quality**: Based on image content
- **Memory Monitoring**: Real-time memory usage tracking

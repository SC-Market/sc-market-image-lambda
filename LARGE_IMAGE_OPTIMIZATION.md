# Large Image Processing Optimization for 24MB Lambda

## Overview

This document explains the optimizations made to handle large images within the 24MB Lambda memory constraint.

## Memory Constraints

- **Lambda Memory Limit**: 24MB total
- **Available for Image Processing**: ~18-20MB (leaving 4-6MB for runtime, logging, etc.)
- **Maximum Upload Size**: 2MB (as per business requirements)
- **Maximum Processing Size**: 5MB (allows for format conversion overhead)

## Key Optimizations

### 1. Sharp Configuration

- **`limitInputPixels`**: 67,108,864 (~8K x 8K pixels)
- **`sequentialRead`**: Enabled for better memory usage
- **`failOnError`**: Disabled to prevent crashes

### 2. Image Dimension Limits

- **Maximum Width/Height**: 8,192 pixels
- **Memory Estimation**: Width × Height × 4 bytes per pixel
- **Warning Threshold**: 18MB estimated usage

### 3. WebP Compression Settings

- **Conservative Mode**: Triggered at 2MB+ (reduced from 5MB)
- **Effort Reduction**: Capped at 1 for large images (vs. normal 4)
- **Quality Reduction**: Capped at 70 for large images (vs. normal 80)

### 4. Error Handling

- **Memory Errors**: Only thrown for actual memory issues
- **Format Errors**: Separate error type for invalid images
- **Dimension Errors**: Specific error for oversized images

## Environment Variables

```bash
# Large Image Processing Configuration (24MB Lambda Optimized)
MAX_INPUT_PIXELS=67108864
MAX_PROCESSING_SIZE=5242880
SHARP_MEMORY_LIMIT=256
SHARP_CACHE_MEMORY=25
MAX_IMAGE_DIMENSION=8192
```

## Processing Workflow

1. **Upload Validation**: Check 2MB limit
2. **Format Validation**: Ensure supported format
3. **Memory Estimation**: Calculate approximate memory usage
4. **Sharp Processing**: Apply memory-optimized settings
5. **Format Conversion**: Use conservative settings for large images
6. **Error Handling**: Provide clear error messages

## Best Practices

### For Developers

- Test with actual image files, not dummy buffers
- Monitor memory usage in CloudWatch
- Use the test script: `yarn test:large-image`

### For Users

- Keep images under 2MB
- Avoid extremely high-resolution images
- Use WebP format when possible for better compression

## Troubleshooting

### Common Issues

1. **"Image too large"**: Reduce image dimensions or file size
2. **"Memory limit exceeded"**: Image requires more memory than available
3. **"Invalid format"**: Ensure image is valid WebP, JPG, or PNG

### Monitoring

- Enable CloudWatch logging
- Monitor memory usage metrics
- Check error rates and types

## Performance Characteristics

- **Small Images (<1MB)**: Fast processing, high quality
- **Medium Images (1-2MB)**: Normal processing, balanced quality
- **Large Images (2MB+)**: Conservative processing, reduced quality
- **Very Large Images (>5MB)**: Rejected with clear error message

## Future Improvements

- Stream-based processing for very large images
- Progressive JPEG support
- Adaptive quality based on image content
- Memory usage monitoring and alerts

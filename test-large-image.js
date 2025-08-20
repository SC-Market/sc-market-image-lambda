#!/usr/bin/env node

/**
 * Test script for modular image processing
 * This helps debug memory and processing issues with large images
 */

const { ImageProcessor } = require('./dist/utils/image_processor');
const fs = require('fs');
const path = require('path');

// Test with different buffer sizes (optimized for 24MB Lambda)
const testSizes = [
  1024 * 1024, // 1MB
  2 * 1024 * 1024, // 2MB
  3 * 1024 * 1024, // 3MB (max processing size)
  4 * 1024 * 1024, // 4MB (should fail gracefully)
];

async function testModularImageProcessing() {
  console.log(
    '🧪 Testing Modular ImageProcessor with different buffer sizes...\n'
  );

  for (const size of testSizes) {
    console.log(
      `📏 Testing with ${(size / (1024 * 1024)).toFixed(1)}MB buffer...`
    );

    try {
      // Create a dummy buffer of the specified size (filled with random data to simulate image)
      const buffer = Buffer.alloc(size, Math.random().toString());

      // Test format validation
      const isSupported = ImageProcessor.isSupportedFormat('image/jpeg');
      console.log(`  ✅ Format validation: ${isSupported}`);

      // Test size validation
      const isValidSize = ImageProcessor.validateImageSize(buffer);
      console.log(`  ✅ Size validation: ${isValidSize}`);

      // Test processing limits
      const limits = ImageProcessor.getProcessingLimits();
      console.log(`  📊 Processing limits:`, limits);

      // Test Rekognition compatibility conversion
      console.log(`  🔍 Testing Rekognition compatibility conversion...`);
      try {
        const rekognitionImage =
          await ImageProcessor.convertToRekognitionCompatible(
            buffer,
            'image/jpeg'
          );
        console.log(`  ✅ Rekognition compatibility:`, {
          format: rekognitionImage.format,
          converted: rekognitionImage.converted,
          bufferSize:
            (rekognitionImage.buffer.length / (1024 * 1024)).toFixed(1) + 'MB',
        });

        // Test WebP conversion
        console.log(`  🖼️  Testing WebP conversion...`);
        const webpImage = await ImageProcessor.convertToWebPIfNeeded(
          buffer,
          'image/jpeg'
        );
        console.log(`  ✅ WebP conversion:`, {
          format: webpImage.format,
          converted: webpImage.converted,
          originalSize: (buffer.length / (1024 * 1024)).toFixed(1) + 'MB',
          webpSize: (webpImage.buffer.length / (1024 * 1024)).toFixed(1) + 'MB',
        });

        console.log(
          `  ✅ All tests passed for ${(size / (1024 * 1024)).toFixed(1)}MB\n`
        );
      } catch (processError) {
        console.log(`  ❌ Image processing failed:`);
        console.log(`     Error: ${processError.message}`);
        console.log(`     Type: ${processError.constructor.name}`);
        if (processError.statusCode) {
          console.log(`     Status: ${processError.statusCode}`);
        }
        console.log(
          `     This indicates a real issue with large image processing\n`
        );
        break;
      }
    } catch (error) {
      console.log(`  ❌ Failed at ${(size / (1024 * 1024)).toFixed(1)}MB:`);
      console.log(`     Error: ${error.message}`);
      console.log(`     Type: ${error.constructor.name}`);
      if (error.statusCode) {
        console.log(`     Status: ${error.statusCode}`);
      }
      console.log('');

      // Stop testing larger sizes if this one failed
      break;
    }
  }

  console.log('🏁 Testing completed!');
}

// Run the test
testModularImageProcessing().catch(console.error);

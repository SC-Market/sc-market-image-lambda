import { S3 } from '@aws-sdk/client-s3';
import { Rekognition } from '@aws-sdk/client-rekognition';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import logger from '../logger';

export interface ContentModerationResult {
  passed: boolean;
  moderationLabels: string[];
  confidence: number;
  error?: string;
}

export class RekognitionClient {
  private static readonly s3 = new S3({
    region: process.env.AWS_REGION || 'us-east-2',
    endpoint: 'https://s3.us-east-2.amazonaws.com',
  });

  private static readonly rekognition = new Rekognition({
    region: process.env.AWS_REGION || 'us-east-2',
  });

  /**
   * Uploads an image to S3, scans it with Amazon Rekognition for content moderation,
   * and then deletes the resource from S3
   * @param imageBuffer - The image buffer to scan (must be PNG or JPG)
   * @param contentType - The MIME type of the image ('image/jpeg' or 'image/png')
   * @returns Promise<ContentModerationResult> - Whether the image passed moderation
   */
  static async scanImageForModeration(
    imageBuffer: Buffer,
    contentType: string
  ): Promise<ContentModerationResult> {
    logger.info('Starting content moderation scan', {
      contentType,
      bufferSize: imageBuffer.length,
      bufferSizeMB: (imageBuffer.length / (1024 * 1024)).toFixed(2),
    });

    // AWS Solutions approach: Convert non-JPEG/PNG images to PNG for Rekognition compatibility
    let rekognitionBuffer = imageBuffer;
    let rekognitionContentType = contentType;

    if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
      logger.info('Converting image to PNG for Rekognition compatibility', {
        originalContentType: contentType,
      });

      try {
        // Use AWS Solutions approach: failOnError: false and limitInputPixels
        const options = {
          failOnError: false,
          limitInputPixels: 268402689,
        };

        // Convert to PNG using Sharp
        rekognitionBuffer = await sharp(imageBuffer, options).png().toBuffer();

        rekognitionContentType = 'image/png';
        logger.info('Image converted to PNG successfully for Rekognition', {
          originalSize: imageBuffer.length,
          convertedSize: rekognitionBuffer.length,
          originalContentType: contentType,
          convertedContentType: rekognitionContentType,
        });
      } catch (conversionError) {
        logger.error('Failed to convert image to PNG for Rekognition', {
          originalContentType: contentType,
          errorMessage:
            conversionError instanceof Error
              ? conversionError.message
              : 'Unknown error',
          errorType: conversionError?.constructor?.name || 'Unknown',
        });
        throw new Error(
          `Failed to convert image to PNG for Rekognition: ${conversionError}`
        );
      }
    }

    const tempKey = `temp-moderation/${uuidv4()}-${Date.now()}.${rekognitionContentType === 'image/jpeg' ? 'jpg' : 'png'}`;

    try {
      // 1. Upload image to S3 for scanning
      await this.s3.putObject({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: tempKey,
        Body: rekognitionBuffer,
        ContentType: rekognitionContentType,
      });

      logger.info('Image uploaded to S3 for moderation', {
        tempKey,
        contentType: rekognitionContentType,
      });

      // 2. Scan with Amazon Rekognition for content moderation
      const moderationResult = await this.rekognition.detectModerationLabels({
        Image: {
          S3Object: {
            Bucket: process.env.S3_BUCKET_NAME!,
            Name: tempKey,
          },
        },
        MinConfidence: 50, // Minimum confidence threshold for moderation labels
      });

      logger.info('Rekognition moderation scan completed', {
        hasModerationLabels: !!moderationResult.ModerationLabels?.length,
        labelCount: moderationResult.ModerationLabels?.length || 0,
      });

      // 3. Process moderation results
      const moderationLabels = moderationResult.ModerationLabels || [];
      const maxConfidence = moderationLabels.reduce(
        (max, label) => Math.max(max, label.Confidence || 0),
        0
      );

      // Check if any explicit content was detected
      const explicitContentLabels = [
        'Explicit Nudity',
        'Violence',
        'Visually Disturbing',
        'Hate Symbols',
        'Gambling',
        'Drugs',
        'Tobacco',
        'Alcohol',
        'Rude Gestures',
        'Adult Content',
      ];

      const hasExplicitContent = moderationLabels.some(
        label =>
          explicitContentLabels.includes(label.Name || '') &&
          (label.Confidence || 0) >= 70
      );

      // 4. Clean up S3 resource
      await this.s3.deleteObject({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: tempKey,
      });

      logger.info('Temporary S3 object cleaned up', { tempKey });

      return {
        passed: !hasExplicitContent,
        moderationLabels: moderationLabels
          .map(label => label.Name || '')
          .filter(Boolean),
        confidence: maxConfidence,
      };
    } catch (error) {
      logger.error('Error during content moderation scan', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown',
        tempKey,
      });

      // Attempt to clean up the temporary S3 object even if there was an error
      try {
        await this.s3.deleteObject({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: tempKey,
        });
        logger.info('Cleaned up temporary S3 object after error', { tempKey });
      } catch (cleanupError) {
        logger.warn('Failed to clean up temporary S3 object', {
          cleanupError,
          tempKey,
        });
      }

      return {
        passed: false,
        moderationLabels: [],
        confidence: 0,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Alternative method that accepts a file path instead of buffer
   * @param filePath - Path to the image file
   * @param contentType - The MIME type of the image ('image/jpeg' or 'image/png')
   * @returns Promise<ContentModerationResult> - Whether the image passed moderation
   */
  static async scanImageFileForModeration(
    filePath: string,
    contentType: string
  ): Promise<ContentModerationResult> {
    const fs = await import('node:fs');
    const imageBuffer = fs.readFileSync(filePath);
    return this.scanImageForModeration(imageBuffer, contentType);
  }
}

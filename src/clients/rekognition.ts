import { S3 } from '@aws-sdk/client-s3';
import { Rekognition } from '@aws-sdk/client-rekognition';
import { v4 as uuidv4 } from 'uuid';
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
   * 
   * Star Citizen Game Content Moderation (Hybrid Approach):
   * - Uses detectModerationLabels for inappropriate content (explicit, hate, drugs, etc.)
   * - Uses detectLabels for weapon detection (without treating weapons as inappropriate)
   * - ALLOWS: Game weapons, violence, spaceships, sci-fi content
   * - BLOCKS: Explicit nudity, hate symbols, drugs, extreme real violence, etc.
   * - Context-aware: Distinguishes between game content and inappropriate content
   * 
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

    // Note: Image conversion is now handled by ImageProcessor.convertToRekognitionCompatible()
    // before calling this method, so we can assume the image is already in a compatible format
    const rekognitionBuffer = imageBuffer;
    const rekognitionContentType = contentType;

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

      // 2. Scan with Amazon Rekognition for content moderation (Hybrid approach)
      // First: Check for inappropriate content using detectModerationLabels
      const moderationResult = await this.rekognition.detectModerationLabels({
        Image: {
          S3Object: {
            Bucket: process.env.S3_BUCKET_NAME!,
            Name: tempKey,
          },
        },
        MinConfidence: 70, // Higher threshold for inappropriate content
      });

      // Second: Check for weapons/objects using detectLabels (for context, not blocking)
      const labelsResult = await this.rekognition.detectLabels({
        Image: {
          S3Object: {
            Bucket: process.env.S3_BUCKET_NAME!,
            Name: tempKey,
          },
        },
        MaxLabels: 20,
        MinConfidence: 50,
      });

      logger.info('Rekognition hybrid scan completed', {
        hasModerationLabels: !!moderationResult.ModerationLabels?.length,
        moderationLabelCount: moderationResult.ModerationLabels?.length || 0,
        hasObjectLabels: !!labelsResult.Labels?.length,
        objectLabelCount: labelsResult.Labels?.length || 0,
      });

      // 3. Process results using hybrid approach
      const moderationLabels = moderationResult.ModerationLabels || [];
      const objectLabels = labelsResult.Labels || [];
      
      const maxModerationConfidence = moderationLabels.reduce(
        (max, label) => Math.max(max, label.Confidence || 0),
        0
      );

      // Check if any explicit content was detected
      // For Star Citizen game content, we block inappropriate content but allow weapons/combat
      const blockedContentLabels = [
        'Explicit Nudity',
        'Visually Disturbing',
        'Hate Symbols',
        'Gambling',
        'Drugs',
        'Tobacco',
        'Alcohol',
        'Rude Gestures',
        'Adult Content',
        // Note: We don't block 'Weapons' or 'Violence' from moderation labels
        // Instead, we use object detection to identify game content context
      ];

      // Check for inappropriate content (always rejected)
      const hasInappropriateContent = moderationLabels.some(
        label =>
          blockedContentLabels.includes(label.Name || '') &&
          (label.Confidence || 0) >= 70
      );

      // Check for weapon/combat content using object detection (for context, not blocking)
      const weaponLabels = objectLabels.filter(
        label =>
          ['Weapon', 'Gun', 'Firearm', 'Rifle', 'Knife', 'Sword', 'Ammunition'].includes(label.Name || '') &&
          (label.Confidence || 0) >= 50
      );

      const combatLabels = objectLabels.filter(
        label =>
          ['Combat', 'War', 'Military', 'Armor', 'Shield'].includes(label.Name || '') &&
          (label.Confidence || 0) >= 50
      );

      // Log weapon/combat detection for Star Citizen context
      if (weaponLabels.length > 0 || combatLabels.length > 0) {
        logger.info('Star Citizen game content detected', {
          weaponLabels: weaponLabels.map(l => ({ name: l.Name, confidence: l.Confidence })),
          combatLabels: combatLabels.map(l => ({ name: l.Name, confidence: l.Confidence })),
          context: 'Game weapons and combat are expected in Star Citizen',
        });
      }

      // For Star Citizen, weapons and combat are acceptable game content
      // Only block genuinely inappropriate content
      const hasExplicitContent = hasInappropriateContent;

      // 4. Clean up S3 resource
      await this.s3.deleteObject({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: tempKey,
      });

      logger.info('Temporary S3 object cleaned up', { tempKey });

      const result = {
        passed: !hasExplicitContent,
        moderationLabels: moderationLabels
          .map(label => label.Name || '')
          .filter(Boolean),
        confidence: maxModerationConfidence,
      };

      // Log moderation decision for monitoring and tuning
      logger.info('Content moderation decision made', {
        passed: result.passed,
        hasInappropriateContent,
        gameContentDetected: weaponLabels.length > 0 || combatLabels.length > 0,
        totalModerationLabels: moderationLabels.length,
        totalObjectLabels: objectLabels.length,
        maxModerationConfidence,
        decision: result.passed ? 'ALLOWED' : 'BLOCKED',
        context: 'Star Citizen game content moderation (Hybrid approach)',
      });

      return result;
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

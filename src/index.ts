import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RekognitionClient } from './clients/rekognition';
import logger from './logger';
import { ImageProcessor } from './utils/image_processor';
import { S3 } from '@aws-sdk/client-s3';
import { ConfigError, getConfig, ImageLambdaConfig } from './config';

let backblazeS3: S3 | undefined;
function backblazeClient(config: ImageLambdaConfig): S3 {
  if (!backblazeS3) {
    backblazeS3 = new S3({
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      region: 'us-west-004',
      credentials: {
        accessKeyId: config.B2_KEY_ID,
        secretAccessKey: config.B2_APP_KEY,
      },
    });
  }
  return backblazeS3;
}

interface UploadRequest {
  imageData: string;
  filename: string;
  contentType?: string;
}

interface LambdaResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Missing config is an outage, not a per-request error: throw so the
  // invocation fails (Lambda Errors metric -> ImageLambdaErrorAlarm) instead of
  // returning a 500 payload that the Errors metric never sees.
  let config: ImageLambdaConfig;
  try {
    config = await getConfig();
  } catch (configError) {
    logger.error('Image lambda configuration unavailable', {
      error: configError instanceof Error ? configError.message : String(configError),
      missing: configError instanceof ConfigError ? configError.missing : undefined,
    });
    throw configError;
  }

  try {
    const body: UploadRequest = event as unknown as UploadRequest;

    if (!body || !body.imageData || !body.filename) {
      logger.debug('Missing required fields in request', { body });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'Missing required fields: imageData and filename',
          error: 'VALIDATION_ERROR',
        } as LambdaResponse),
      };
    }

    const contentType = body.contentType || 'image/jpeg';

    if (!ImageProcessor.isSupportedFormat(contentType)) {
      logger.debug('Unsupported image format', {
        contentType,
        filename: body.filename,
      });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: `Unsupported image format: ${contentType}. Only webp, jpg, and png are supported.`,
          error: 'UNSUPPORTED_FORMAT',
        } as LambdaResponse),
      };
    }

    const imageBuffer = Buffer.from(body.imageData, 'base64');

    // 4MB decoded (~5.3MB base64) stays under the 6MB synchronous-invoke limit.
    // Images are downscaled during WebP conversion, so this only bounds the
    // raw input we're willing to decode.
    const maxSizeBytes = 4 * 1024 * 1024;
    if (imageBuffer.length > maxSizeBytes) {
      logger.debug('Image file size too large', {
        filename: body.filename,
        sizeBytes: imageBuffer.length,
        maxSizeBytes,
        sizeMB: (imageBuffer.length / (1024 * 1024)).toFixed(2),
      });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: `Image file size too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(2)}MB. Maximum allowed size is 4MB.`,
          error: 'FILE_TOO_LARGE',
          data: {
            sizeBytes: imageBuffer.length,
            maxSizeBytes,
            sizeMB: (imageBuffer.length / (1024 * 1024)).toFixed(2),
          },
        } as LambdaResponse),
      };
    }

    let moderationResult: { passed: boolean; moderationLabels: string[]; confidence: number };
    try {
      moderationResult = await scanImageForModeration(imageBuffer, contentType, config.S3_BUCKET_NAME);
    } catch (scanError) {
      logger.error('Content moderation scan infrastructure error', {
        filename: body.filename,
        error: scanError instanceof Error ? scanError.message : String(scanError),
      });
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: `Content scanning unavailable: ${scanError instanceof Error ? scanError.message : 'Unknown error'}`,
          error: 'SCAN_INFRA_ERROR',
        } as LambdaResponse),
      };
    }

    if (!moderationResult.passed) {
      logger.info('Image failed moderation checks', {
        filename: body.filename,
        moderationLabels: moderationResult.moderationLabels,
        confidence: moderationResult.confidence,
      });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: moderationResult.moderationLabels.length > 0
            ? `Image rejected: flagged for ${moderationResult.moderationLabels.join(', ')}`
            : 'Image failed moderation checks',
          error: 'MODERATION_FAILED',
          data: {
            moderationLabels: moderationResult.moderationLabels,
            confidence: moderationResult.confidence,
          },
        } as LambdaResponse),
      };
    }

    const finalFilename = body.filename.replace(/\.[^/.]+$/, '.webp');

    const backblazeUrl = await uploadImageToBackblaze(
      config,
      imageBuffer,
      finalFilename,
      contentType
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Image successfully processed and uploaded',
        data: {
          filename: finalFilename,
          backblazeUrl,
          originalFormat:
            ImageProcessor.extractFormatFromContentType(contentType),
          finalFormat: 'webp',
          moderationResult: {
            isAppropriate: true,
            confidence: moderationResult.confidence,
          },
        },
      } as LambdaResponse),
    };
  } catch (error) {
    logger.error('Unexpected error processing image', {
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorType: error?.constructor?.name || 'Unknown',
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: 'Internal server error',
        error: 'INTERNAL_ERROR',
      } as LambdaResponse),
    };
  }
};

async function scanImageForModeration(
  imageBuffer: Buffer,
  contentType: string,
  bucket: string
): Promise<{
  passed: boolean;
  moderationLabels: string[];
  confidence: number;
}> {
  try {
    const rekognitionImage =
      await ImageProcessor.convertToRekognitionCompatible(
        imageBuffer,
        contentType
      );

    const moderationResult = await RekognitionClient.scanImageForModeration(
      rekognitionImage.buffer,
      ImageProcessor.getMimeType(rekognitionImage.format),
      bucket
    );

    return {
      passed: moderationResult.passed,
      moderationLabels: moderationResult.moderationLabels,
      confidence: moderationResult.confidence,
    };
  } catch (error) {
    throw error;
  }
}

async function uploadImageToBackblaze(
  config: ImageLambdaConfig,
  imageBuffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  try {
    const webpImage = await ImageProcessor.convertToWebPIfNeeded(
      imageBuffer,
      contentType
    );

    await backblazeClient(config).putObject({
      Bucket: config.B2_BUCKET_NAME,
      Key: filename,
      Body: webpImage.buffer,
      ContentType: ImageProcessor.getMimeType(webpImage.format),
    });

    return `${config.CDN_URL}/${filename}`;
  } catch (error) {
    throw new Error(`Failed to upload image to Backblaze: ${error}`);
  }
}

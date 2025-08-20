import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RekognitionClient } from './clients/rekognition';
import logger from './logger';
import { ImageProcessor } from './utils/image_processor';
import { S3 } from '@aws-sdk/client-s3';

const backblazeS3 = new S3({
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APP_KEY!,
  },
});

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

    const maxSizeBytes = 2 * 1024 * 1024;
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
          message: `Image file size too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(2)}MB. Maximum allowed size is 2MB.`,
          error: 'FILE_TOO_LARGE',
          data: {
            sizeBytes: imageBuffer.length,
            maxSizeBytes,
            sizeMB: (imageBuffer.length / (1024 * 1024)).toFixed(2),
          },
        } as LambdaResponse),
      };
    }

    const moderationResult = await scanImageForModeration(
      imageBuffer,
      contentType
    );
    if (!moderationResult.passed) {
      logger.debug('Image failed moderation checks', {
        filename: body.filename,
        moderationLabels: moderationResult.moderationLabels,
        confidence: moderationResult.confidence,
      });
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
        } as LambdaResponse),
      };
    }

    const finalFilename = body.filename.replace(/\.[^/.]+$/, '.webp');

    const backblazeUrl = await uploadImageToBackblaze(
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
  contentType: string
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
      ImageProcessor.getMimeType(rekognitionImage.format)
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
  imageBuffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  try {
    const webpImage = await ImageProcessor.convertToWebPIfNeeded(
      imageBuffer,
      contentType
    );

    await backblazeS3.putObject({
      Bucket: process.env.B2_BUCKET_NAME!,
      Key: filename,
      Body: webpImage.buffer,
      ContentType: ImageProcessor.getMimeType(webpImage.format),
    });

    return `${process.env.CDN_URL}/${filename}`;
  } catch (error) {
    throw new Error(`Failed to upload image to Backblaze: ${error}`);
  }
}

import sharp from 'sharp';
import logger from '../logger';

export class ImageProcessorError extends Error {
  constructor(
    public statusCode: number,
    public errorType: string,
    message: string
  ) {
    super(message);
    this.name = 'ImageProcessorError';
  }
}

export class ImageProcessor {
  private static readonly SUPPORTED_FORMATS = ['webp', 'jpg', 'jpeg', 'png'];
  private static readonly REKOGNITION_COMPATIBLE_FORMATS = ['jpeg', 'png'];
  private static readonly MAX_INPUT_PIXELS = 67108864;
  private static readonly MAX_PROCESSING_SIZE = 5 * 1024 * 1024;
  private static readonly MAX_IMAGE_DIMENSION = 8192;

  static isSupportedFormat(contentType: string): boolean {
    const format = this.extractFormatFromContentType(contentType);
    return this.SUPPORTED_FORMATS.includes(format);
  }

  static extractFormatFromContentType(contentType: string): string {
    return contentType.toLowerCase().replace('image/', '');
  }

  static getMimeType(format: string): string {
    const formatMap: Record<string, string> = {
      webp: 'image/webp',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
    };
    return formatMap[format] || 'image/jpeg';
  }

  private static async instantiateSharpImage(
    imageBuffer: Buffer,
    options: sharp.SharpOptions = {}
  ): Promise<sharp.Sharp> {
    try {
      const enhancedOptions: sharp.SharpOptions = {
        failOnError: false,
        limitInputPixels: this.MAX_INPUT_PIXELS,
        sequentialRead: true,
        ...options,
      };

      const metadata = await sharp(imageBuffer, enhancedOptions).metadata();

      if (metadata.width && metadata.height) {
        if (
          metadata.width > this.MAX_IMAGE_DIMENSION ||
          metadata.height > this.MAX_IMAGE_DIMENSION
        ) {
          logger.debug('Image dimensions exceed limits', {
            width: metadata.width,
            height: metadata.height,
            maxDimension: this.MAX_IMAGE_DIMENSION,
          });
          throw new ImageProcessorError(
            413,
            'ImageTooLarge',
            `Image dimensions (${metadata.width}x${metadata.height}) exceed maximum allowed (${this.MAX_IMAGE_DIMENSION}x${this.MAX_IMAGE_DIMENSION}). Please reduce image dimensions.`
          );
        }
      }

      return sharp(imageBuffer, enhancedOptions).withMetadata();
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes('memory') ||
          (error.message.includes('buffer') &&
            !error.message.includes('unsupported image format') &&
            !error.message.includes(
              'Input buffer contains unsupported image format'
            ))
        ) {
          logger.error('Memory limit exceeded during image processing', {
            bufferSize: imageBuffer.length,
            maxProcessingSize: this.MAX_PROCESSING_SIZE,
          });
          throw new ImageProcessorError(
            413,
            'MemoryLimitExceeded',
            'Image is too large to process in 24MB Lambda environment. Please reduce image size and try again.'
          );
        }
        if (
          error.message.includes('pixel') ||
          error.message.includes('dimension')
        ) {
          logger.error('Image dimensions too large for processing', {
            bufferSize: imageBuffer.length,
            maxInputPixels: this.MAX_INPUT_PIXELS,
          });
          throw new ImageProcessorError(
            413,
            'ImageTooLarge',
            'Image dimensions are too large for 24MB Lambda environment. Please reduce image dimensions and try again.'
          );
        }
        if (
          error.message.includes('unsupported image format') ||
          error.message.includes(
            'Input buffer contains unsupported image format'
          )
        ) {
          logger.debug('Invalid image format provided', {
            bufferSize: imageBuffer.length,
            errorMessage: error.message,
          });
          throw new ImageProcessorError(
            400,
            'InvalidImageFormat',
            'The provided data is not a valid image format. Please ensure you are uploading a valid image file.'
          );
        }
      }

      logger.error('Image instantiation failed', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown',
        bufferSize: imageBuffer.length,
      });
      throw new ImageProcessorError(
        400,
        'InstantiationError',
        'Input image could not be instantiated. Please choose a valid image.'
      );
    }
  }

  static async convertToRekognitionCompatible(
    imageBuffer: Buffer,
    contentType: string
  ): Promise<{ buffer: Buffer; format: string; converted: boolean }> {
    const originalFormat = this.extractFormatFromContentType(contentType);

    if (this.REKOGNITION_COMPATIBLE_FORMATS.includes(originalFormat)) {
      return {
        buffer: imageBuffer,
        format: originalFormat,
        converted: false,
      };
    }

    try {
      const pngBuffer = await this.convertToPNG(imageBuffer);

      return {
        buffer: pngBuffer,
        format: 'png',
        converted: true,
      };
    } catch (error) {
      logger.error('Failed to convert to Rekognition compatible format', {
        originalFormat,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        bufferSize: imageBuffer.length,
      });
      throw new ImageProcessorError(
        500,
        'RekognitionCompatibilityError',
        'Failed to convert image to Rekognition compatible format.'
      );
    }
  }

  static async convertToWebPIfNeeded(
    imageBuffer: Buffer,
    contentType: string
  ): Promise<{ buffer: Buffer; format: string; converted: boolean }> {
    const originalFormat = this.extractFormatFromContentType(contentType);

    if (originalFormat === 'webp') {
      return {
        buffer: imageBuffer,
        format: 'webp',
        converted: false,
      };
    }

    try {
      const webpBuffer = await this.convertToWebP(imageBuffer);

      return {
        buffer: webpBuffer,
        format: 'webp',
        converted: true,
      };
    } catch (error) {
      if (error instanceof ImageProcessorError) {
        throw error;
      }

      if (error instanceof Error) {
        if (
          error.message.includes('memory') ||
          error.message.includes('buffer')
        ) {
          logger.error('Memory limit exceeded during WebP conversion', {
            bufferSize: imageBuffer.length,
            maxProcessingSize: this.MAX_PROCESSING_SIZE,
          });
          throw new ImageProcessorError(
            413,
            'MemoryLimitExceeded',
            'Image is too large to convert to WebP in 24MB Lambda environment. Please reduce image size and try again.'
          );
        }
        if (
          error.message.includes('timeout') ||
          error.message.includes('timed out')
        ) {
          logger.error('WebP conversion timed out', {
            bufferSize: imageBuffer.length,
            errorMessage: error.message,
          });
          throw new ImageProcessorError(
            408,
            'ProcessingTimeout',
            'Image conversion timed out. Please try with a smaller image.'
          );
        }
      }

      logger.error('WebP conversion failed', {
        originalFormat,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown',
        bufferSize: imageBuffer.length,
      });
      throw new ImageProcessorError(
        500,
        'WebPConversionError',
        'Failed to convert image to WebP format.'
      );
    }
  }

  private static async convertToPNG(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const sharpInstance = await this.instantiateSharpImage(imageBuffer);

      return await sharpInstance
        .png({
          compressionLevel: 6,
          adaptiveFiltering: true,
        })
        .toBuffer();
    } catch (error) {
      logger.error('PNG conversion failed', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown',
        bufferSize: imageBuffer.length,
      });
      throw new ImageProcessorError(
        500,
        'PNGConversionError',
        'Failed to convert image to PNG format.'
      );
    }
  }

  private static async convertToWebP(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const sharpInstance = await this.instantiateSharpImage(imageBuffer);

      return await sharpInstance.webp({ quality: 80 }).toBuffer();
    } catch (error) {
      if (error instanceof ImageProcessorError) {
        throw error;
      }

      if (error instanceof Error) {
        if (
          error.message.includes('memory') ||
          error.message.includes('buffer')
        ) {
          logger.error('Memory limit exceeded during WebP conversion', {
            bufferSize: imageBuffer.length,
            maxProcessingSize: this.MAX_PROCESSING_SIZE,
          });
          throw new ImageProcessorError(
            413,
            'MemoryLimitExceeded',
            'Image is too large to convert to WebP in 24MB Lambda environment. Please reduce image size and try again.'
          );
        }
        if (
          error.message.includes('timeout') ||
          error.message.includes('timed out')
        ) {
          logger.error('WebP conversion timed out', {
            bufferSize: imageBuffer.length,
            errorMessage: error.message,
          });
          throw new ImageProcessorError(
            408,
            'ProcessingTimeout',
            'Image conversion timed out. Please try with a smaller image.'
          );
        }
      }

      logger.error('WebP conversion failed', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown',
        bufferSize: imageBuffer.length,
      });
      throw new ImageProcessorError(
        500,
        'WebPConversionError',
        'Failed to convert image to WebP format.'
      );
    }
  }
}

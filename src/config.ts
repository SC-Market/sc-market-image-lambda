import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';

/**
 * Runtime secrets/config the lambda needs on every image upload.
 *
 * Source is chosen explicitly by SECRETS_SSM_PATH:
 * - set (CDK sets it to /sc-market/image-lambda): read SecureString parameters
 *   `${SECRETS_SSM_PATH}/<NAME>` from SSM Parameter Store at cold start. A
 *   `cdk deploy ImageLambdaStack` owns the function's Environment and resets
 *   it, so secrets must not live there.
 * - unset: read the same names from the function's environment (the pre-SSM
 *   setup, applied by this repo's deploy workflow).
 *
 * Any missing or empty value is a hard error: the handler throws, so the
 * invocation fails (FunctionError) and the Errors alarm fires, instead of
 * every upload quietly returning SCAN_INFRA_ERROR.
 */
export const CONFIG_NAMES = [
  'B2_KEY_ID',
  'B2_APP_KEY',
  'B2_BUCKET_NAME',
  'S3_BUCKET_NAME',
  'CDN_URL',
] as const;
export type ConfigName = (typeof CONFIG_NAMES)[number];
export type ImageLambdaConfig = Record<ConfigName, string>;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly missing: string[]
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

type SsmLike = Pick<SSMClient, 'send'>;

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  ssm: SsmLike = new SSMClient({ region: env.AWS_REGION })
): Promise<ImageLambdaConfig> {
  const path = env.SECRETS_SSM_PATH;
  const values: Partial<ImageLambdaConfig> = {};

  if (path) {
    const prefix = path.replace(/\/+$/, '');
    const names = CONFIG_NAMES.map(n => `${prefix}/${n}`);
    const res = await ssm.send(
      new GetParametersCommand({ Names: names, WithDecryption: true })
    );
    for (const p of res.Parameters ?? []) {
      const key = p.Name?.slice(prefix.length + 1) as ConfigName | undefined;
      if (key && (CONFIG_NAMES as readonly string[]).includes(key) && p.Value)
        values[key] = p.Value;
    }
    const missing = names.filter((_, i) => !values[CONFIG_NAMES[i]]);
    if (missing.length > 0) {
      throw new ConfigError(
        `Missing SSM parameters: ${missing.join(', ')}`,
        missing
      );
    }
  } else {
    for (const n of CONFIG_NAMES) {
      if (env[n]) values[n] = env[n];
    }
    const missing = CONFIG_NAMES.filter(n => !values[n]);
    if (missing.length > 0) {
      throw new ConfigError(
        `Missing required environment variables: ${missing.join(', ')}`,
        missing
      );
    }
  }

  return values as ImageLambdaConfig;
}

let cached: Promise<ImageLambdaConfig> | undefined;

/** Loads config once per execution environment; a failed load is retried on the next invocation. */
export function getConfig(): Promise<ImageLambdaConfig> {
  if (!cached) {
    cached = loadConfig().catch(err => {
      cached = undefined;
      throw err;
    });
  }
  return cached;
}

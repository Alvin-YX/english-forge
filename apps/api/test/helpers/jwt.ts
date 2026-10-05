import { JwtService } from '@nestjs/jwt';

import { buildJwtOptions } from '../../src/infra/profile/jwt-tokens.js';

import { TEST_ACCESS_SECRET, TEST_ISSUER } from './test-env.js';

/** Sign a JWT for testing — same pattern as system.healthz.spec.ts */
export function sign(
  payload: Record<string, unknown>,
  options: { secret?: string; expiresIn?: number } = {},
): string {
  const service = new JwtService(
    buildJwtOptions(options.secret ?? TEST_ACCESS_SECRET, TEST_ISSUER, 900),
  );
  return service.sign(payload, { expiresIn: options.expiresIn ?? 900 }) as string;
}

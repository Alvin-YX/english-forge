/**
 * 响应包装模块 —— 提供 EnvelopeInterceptor
 */

import { Global, Module } from '@nestjs/common';

import { EnvelopeInterceptor } from './envelope.interceptor.js';

@Global()
@Module({
  providers: [EnvelopeInterceptor],
  exports: [EnvelopeInterceptor],
})
export class EnvelopeModule {}

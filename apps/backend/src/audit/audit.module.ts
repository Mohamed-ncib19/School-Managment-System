import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { DbModule } from '../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    // Global: establishes the per-request audit context for every handler and
    // backstops any state-changing route that does not log for itself.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}

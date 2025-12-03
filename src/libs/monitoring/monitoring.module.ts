import { Module } from '@nestjs/common';
import { ErrorTrackingService } from './error-tracking.service';
import { ErrorMetricsService } from './error-metrics.service';

@Module({
  providers: [ErrorTrackingService, ErrorMetricsService],
  exports: [ErrorTrackingService, ErrorMetricsService],
})
export class MonitoringModule {}


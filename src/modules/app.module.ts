import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AccountsModule } from "./accounts/accounts.module";
import { AdminModule } from "./admin/admin.module";
import { DatabaseModule } from "./database/database.module";
import { MonitoringModule } from "../libs/monitoring/monitoring.module";
import { CorrelationMiddleware } from "../libs/correlation/correlation.middleware";
import { GlobalExceptionFilter } from "../libs/exceptions/global-exception.filter";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigModule available globally
      envFilePath: ".env", // Path to .env file
    }),
    DatabaseModule,
    MonitoringModule,
    AccountsModule,
    AdminModule,
  ],
  providers: [GlobalExceptionFilter], // Provide filter so it can be injected with dependencies
  exports: [GlobalExceptionFilter], // Export for use in main.ts
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes("*"); // Apply to all routes
  }
}

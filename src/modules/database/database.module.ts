import { Module, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MongoClient, Db } from "mongodb";
import { MonitoringModule } from "../../libs/monitoring/monitoring.module";
import { ErrorActionService } from "../../libs/exceptions/error-action.service";
import { DatabaseConnectionErrorHandler } from "./error-handlers/database-connection-error.handler";

export const MONGO = "MONGO_CONNECTION";
export const DB = "MONGO_DB";

@Module({
  imports: [MonitoringModule],
  providers: [
    {
      provide: MONGO,
      useFactory: async (configService: ConfigService) => {
        const url = configService.get<string>(
          "MONGODB_URL",
          "mongodb://localhost:27017",
        );
        const client = new MongoClient(url, {
          maxPoolSize: 50, // Max connections in pool
          minPoolSize: 10, // Keep minimum connections warm
          maxIdleTimeMS: 30000, // Close idle connections after 30s
          serverSelectionTimeoutMS: 5000, // Fail fast if can't select server
          socketTimeoutMS: 45000, // Close socket after 45s of inactivity
        });
        await client.connect();
        console.log("[MongoDB] Connected successfully with connection pooling");
        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: DB,
      useFactory: (client: MongoClient, configService: ConfigService): Db => {
        const dbName = configService.get<string>(
          "MONGODB_DB_NAME",
          "banking_cqrs",
        );
        return client.db(dbName);
      },
      inject: [MONGO, ConfigService],
    },
    DatabaseConnectionErrorHandler,
  ],
  exports: [MONGO, DB],
})
export class DatabaseModule implements OnModuleInit {
  constructor(
    private readonly errorActionService: ErrorActionService,
    private readonly dbErrorHandler: DatabaseConnectionErrorHandler,
  ) {}

  onModuleInit() {
    this.errorActionService.registerHandler(this.dbErrorHandler);
  }
}

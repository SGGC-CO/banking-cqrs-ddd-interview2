import { Module } from '@nestjs/common';
import { MongoClient, Db } from 'mongodb';

export const MONGO = 'MONGO_CONNECTION';
export const DB = 'MONGO_DB';

@Module({
  providers: [
    {
      provide: MONGO,
      useFactory: async () => {
        const url = process.env.MONGODB_URL || 'mongodb://localhost:27017';
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
    },
    {
      provide: DB,
      useFactory: (client: MongoClient): Db => {
        const dbName = process.env.MONGODB_DB_NAME || 'banking_cqrs';
        return client.db(dbName);
      },
      inject: [MONGO],
    },
  ],
  exports: [MONGO, DB],
})
export class DatabaseModule {}


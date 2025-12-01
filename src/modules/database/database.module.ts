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
        const client = new MongoClient(url);
        await client.connect();
        console.log('[MongoDB] Connected successfully');
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


import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { AdminModule } from './admin/admin.module';
import { MongoClient } from 'mongodb';

export const MONGO = 'MONGO_CONNECTION';
export const DB = 'MONGO_DB';

@Module({
  imports: [AccountsModule, AdminModule],
  providers: [
    {
      provide: MONGO,
      useFactory: async () => {
        const url = 'mongodb://localhost:27017';
        const client = new MongoClient(url);
        await client.connect();
        return client;
      },
    },
    {
      provide: DB,
      useFactory: (client: MongoClient) => {
        const dbName = 'banking_cqrs';
        return client.db(dbName);
      },
      inject: [MONGO],
    },
  ],
  exports: [MONGO, DB],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AccountsModule],
  controllers: [AdminController],
  providers: [],
})
export class AdminModule {}

import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { MonitoringModule } from "../../libs/monitoring/monitoring.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [AccountsModule, MonitoringModule],
  controllers: [AdminController],
  providers: [],
})
export class AdminModule {}

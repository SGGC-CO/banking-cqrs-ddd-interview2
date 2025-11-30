import { Injectable, OnModuleInit } from '@nestjs/common';
import { CommandBus } from '../../../libs/cqrs/command-bus';
import { EventBus } from '../../../libs/cqrs/event-bus';
import { QueryBus } from '../../../libs/cqrs/query-bus';
import { DepositHandler } from '../application/handlers/deposit.handler';
import { GetAccountHandler } from '../application/handlers/get-account.handler';
import { OpenAccountHandler } from '../application/handlers/open-account.handler';
import { WithdrawHandler } from '../application/handlers/withdraw.handler';
import { AccountsProjection } from './projection/accounts.projection';

/**
 * Service responsible for wiring up command handlers, query handlers,
 * and event subscribers to their respective buses.
 * 
 * Implements OnModuleInit to ensure wiring happens during NestJS initialization.
 */
@Injectable()
export class BusWiringService implements OnModuleInit {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly eventBus: EventBus,
    private readonly openAccountHandler: OpenAccountHandler,
    private readonly depositHandler: DepositHandler,
    private readonly withdrawHandler: WithdrawHandler,
    private readonly getAccountHandler: GetAccountHandler,
    private readonly accountsProjection: AccountsProjection,
  ) {}

  /**
   * Called once the module has been initialized.
   * Registers all handlers and subscribers with their respective buses.
   */
  onModuleInit() {
    // Register command handlers
    this.commandBus.register('OpenAccountCommand', this.openAccountHandler);
    this.commandBus.register('DepositCommand', this.depositHandler);
    this.commandBus.register('WithdrawCommand', this.withdrawHandler);

    // Register query handlers
    this.queryBus.register('GetAccountQuery', this.getAccountHandler);

    // Subscribe to domain events for projection updates
    this.eventBus.subscribe('AccountOpenedEvent', (e) => this.accountsProjection.project(e));
    this.eventBus.subscribe('DepositedEvent', (e) => this.accountsProjection.project(e));
    this.eventBus.subscribe('WithdrawnEvent', (e) => this.accountsProjection.project(e));

    console.log('[BusWiring] Successfully wired all handlers and subscribers');
  }
}

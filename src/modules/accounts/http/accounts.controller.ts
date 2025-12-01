import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { CommandBus } from "../../../libs/cqrs/command-bus";
import { QueryBus } from "../../../libs/cqrs/query-bus";
import { OpenAccountDto, AmountDto } from "./dto";
import { v4 as uuid } from "uuid";
import { OpenAccountCommand } from "../application/commands/open-account.command";
import { DepositCommand } from "../application/commands/deposit.command";
import { WithdrawCommand } from "../application/commands/withdraw.command";
import { GetAccountQuery } from "../application/queries/get-account.query";

@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  async open(@Body() dto: OpenAccountDto) {
    const id = uuid();
    await this.commands.execute(
      new OpenAccountCommand(id, dto.ownerId, dto.currency, dto.initialBalance),
    );
    return { accountId: id };
  }

  @Post(":id/deposit")
  async deposit(
    @Param("id") id: string,
    @Body() dto: AmountDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    await this.commands.execute(
      new DepositCommand(id, dto.amount, idempotencyKey),
    );
    return { accountId: id };
  }

  @Post(":id/withdraw")
  async withdraw(
    @Param("id") id: string,
    @Body() dto: AmountDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    await this.commands.execute(
      new WithdrawCommand(id, dto.amount, idempotencyKey),
    );
    return { accountId: id };
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return this.queries.execute(new GetAccountQuery(id));
  }
}

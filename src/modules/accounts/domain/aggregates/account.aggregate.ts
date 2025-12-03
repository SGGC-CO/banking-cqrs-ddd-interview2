import { AggregateRoot } from '../../../../libs/cqrs/aggregate-root';
import {
  InsufficientFundsError,
  InvalidAmountError,
} from "../../../../libs/exceptions/domain.exceptions";
import { AccountOpenedEvent } from "../events/account-opened.event";
import { DepositedEvent } from "../events/deposited.event";
import { WithdrawnEvent } from "../events/withdrawn.event";

export class Account extends AggregateRoot {
  private _ownerId: string;
  private _currency: string;
  private _balance = 0;

  static open(
    id: string,
    ownerId: string,
    currency: string,
    initialBalance: number,
  ) {
    if (initialBalance < 0)
      throw new InvalidAmountError(
        initialBalance,
        "Initial balance cannot be negative",
      );
    const acc = new Account();
    acc.apply(new AccountOpenedEvent(id, ownerId, currency, initialBalance));
    return acc;
  }

  /**
   * Rehydrate Account aggregate from event history
   */
  static rehydrate(storedEvents: any[]): Account {
    return AggregateRoot.rehydrateAggregate(Account, storedEvents);
  }

  deposit(amount: number) {
    if (amount <= 0)
      throw new InvalidAmountError(amount, "Deposit amount must be positive");
    this.apply(new DepositedEvent(this.id!, amount));
  }

  /**
   * Withdraw money from account
   * Validates amount and prevents overdraft
   */
  withdraw(amount: number) {
    if (amount <= 0)
      throw new InvalidAmountError(
        amount,
        "Withdrawal amount must be positive",
      );
    if (this._balance < amount) {
      throw new InsufficientFundsError(this.id!, amount, this._balance);
    }
    this.apply(new WithdrawnEvent(this.id!, amount));
  }

  onAccountOpenedEvent(e: AccountOpenedEvent) {
    this.setId(e.accountId);
    this._ownerId = e.ownerId;
    this._currency = e.currency;
    this._balance = e.balance;
    this.setVersion(0);
  }

  onDepositedEvent(e: DepositedEvent) {
    this._balance += e.amount;
  }

  onWithdrawnEvent(e: WithdrawnEvent) {
    this._balance -= e.amount;
  }

  toJSON() {
    return {
      id: this.id,
      ownerId: this._ownerId,
      currency: this._currency,
      balance: this._balance,
      version: this.version,
    };
  }
}

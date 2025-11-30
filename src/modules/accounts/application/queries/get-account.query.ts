import { Query } from '../../../../libs/cqrs/query';

export class GetAccountQuery extends Query {
  constructor(public readonly accountId: string) { super(); }
}

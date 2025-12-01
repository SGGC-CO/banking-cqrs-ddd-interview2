import { Injectable, Inject } from "@nestjs/common";
import { Collection, Db } from "mongodb";
import { DB } from "../../../database/database.module";
import { GetAccountQuery } from "../queries/get-account.query";

@Injectable()
export class GetAccountHandler {
  private read: Collection;

  constructor(@Inject(DB) db: Db) {
    this.read = db.collection("accounts_read");
    this.read.createIndex({ accountId: 1 }, { unique: true }).catch(() => {});
  }

  async execute(query: GetAccountQuery) {
    const doc = await this.read.findOne({ accountId: query.accountId });
    if (!doc) throw new Error("Account not found (projection)");
    return doc;
  }
}

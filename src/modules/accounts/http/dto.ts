import { IsIn, IsInt, IsString, Min } from 'class-validator';

export class OpenAccountDto {
  @IsString() ownerId: string;
  @IsIn(['USD', 'EUR', 'GBP']) currency: 'USD'|'EUR'|'GBP';
  @IsInt() @Min(0) initialBalance: number;
}





export class AmountDto {
  @IsInt() @Min(1) amount: number;
}

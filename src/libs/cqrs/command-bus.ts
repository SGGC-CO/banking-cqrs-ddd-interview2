import { Injectable } from '@nestjs/common';
import { Command } from './command';

type CommandHandler<T extends Command> = {
  execute(command: T): Promise<any> | any;
};

@Injectable()
export class CommandBus {
  private handlers = new Map<string, CommandHandler<Command>>();

  register(commandName: string, handler: CommandHandler<Command>) {
    this.handlers.set(commandName, handler as any);
  }

  /**
   * Execute a command
   */
  async execute<T extends Command, R = any>(command: T): Promise<R> {
    const handler = this.handlers.get(command.constructor.name);
    if (!handler) throw new Error(`No handler for ${command.constructor.name}`);
    return handler.execute(command);
  }
}

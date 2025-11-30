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
   * INCOMPLETE - TO BE IMPLEMENTED BY INTERVIEWEE
   */
  async execute<T extends Command, R = any>(command: T): Promise<R> {
    // TODO: Implement command execution
    throw new Error('Method not implemented');
  }
}

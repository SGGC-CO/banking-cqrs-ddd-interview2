import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { CircuitBreakerExceptionFilter } from './libs/resilience/circuit-breaker.filter';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new CircuitBreakerExceptionFilter());
  const port = 3000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
bootstrap();

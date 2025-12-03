import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import "reflect-metadata";

import { GlobalExceptionFilter } from "./libs/exceptions/global-exception.filter";
import { ValidationError } from "./libs/exceptions/application.exceptions";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const globalExceptionFilter = app.get(GlobalExceptionFilter);

  // Global validation pipe with custom exception factory
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) => {
        const formattedErrors = errors.map((error) => ({
          field: error.property,
          message: Object.values(error.constraints || {}).join(", "),
          value: error.value,
        }));
        return new ValidationError(formattedErrors);
      },
    }),
  );

  app.useGlobalFilters(globalExceptionFilter);

  const port = 3000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
bootstrap();

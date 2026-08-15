import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip anything the DTO does not declare, and reject the request if the
      // client sent unknown fields - so a typo'd property fails loudly instead
      // of being silently ignored.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const swagger = new DocumentBuilder()
    .setTitle('Mini Operations ERP API')
    .setDescription(
      'Inventory, work orders, internal stock transfers and customer reservations.\n\n' +
        '**Authentication** - call `POST /api/auth/login`, then click Authorize and paste the `accessToken`.\n\n' +
        '**Demo users** (password `Password@123`)\n' +
        '- `admin@ops-erp.local` - Admin: creates work orders, sees reconciliation\n' +
        '- `ops@ops-erp.local` - Operations: inventory and transfers\n' +
        '- `sales@ops-erp.local` - Sales: customer orders and reservations',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('port');
  await app.listen(port, '0.0.0.0');

  logger.log(`API      -> http://localhost:${port}/api`);
  logger.log(`Swagger  -> http://localhost:${port}/api/docs`);
}

bootstrap();

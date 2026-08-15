import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { loadConfig } from './config/configuration';
import { ALL_ENTITIES } from './database/entities';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './auth/auth.module';
import { MastersModule } from './masters/masters.module';
import { InventoryModule } from './inventory/inventory.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';
import { TransfersModule } from './transfers/transfers.module';
import { OrdersModule } from './orders/orders.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      envFilePath: ['.env'],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('database.url'),
        ssl: config.get<boolean>('database.ssl') ? { rejectUnauthorized: false } : false,
        entities: ALL_ENTITIES,
        // Never true. The schema is owned by the checked-in migrations, which
        // is the only way the CHECK constraints are guaranteed to exist in
        // every environment.
        synchronize: false,
        logging: config.get<boolean>('database.logging') ? (['query', 'error'] as const) : (['error'] as const),
      }),
    }),

    AuthModule,
    MastersModule,
    InventoryModule,
    WorkOrdersModule,
    TransfersModule,
    OrdersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: authenticate first, then authorise. Both are global, so
    // security is opt-out (@Public) rather than opt-in.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

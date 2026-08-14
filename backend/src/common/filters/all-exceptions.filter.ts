import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Request, Response } from 'express';

/**
 * Maps a PostgreSQL constraint violation to a meaningful HTTP response.
 *
 * The database is the last line of defence for the business rules, so when it
 * *does* reject something the API must not leak a 500 and a raw driver string.
 * Each constraint name below corresponds to a rule declared on an entity.
 */
const CONSTRAINT_MESSAGES: Record<string, { status: number; message: string }> = {
  CHK_inventory_reserved_lte_physical: {
    status: HttpStatus.CONFLICT,
    message:
      'Cannot reserve more stock than is physically available. Another request most likely took the remaining quantity first.',
  },
  CHK_inventory_physical_non_negative: {
    status: HttpStatus.CONFLICT,
    message: 'Operation would drive physical stock below zero.',
  },
  CHK_inventory_reserved_non_negative: {
    status: HttpStatus.CONFLICT,
    message: 'Operation would drive reserved stock below zero.',
  },
  UQ_inventory_item_location_batch: {
    status: HttpStatus.CONFLICT,
    message: 'An inventory record already exists for this item, location and batch.',
  },
  CHK_transfer_distinct_locations: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Source and destination locations must be different.',
  },
  CHK_transfer_received_qty_range: {
    status: HttpStatus.CONFLICT,
    message: 'Received quantity cannot exceed the dispatched quantity.',
  },
  CHK_order_line_reserved_range: {
    status: HttpStatus.CONFLICT,
    message: 'Reserved quantity cannot exceed the ordered quantity.',
  },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const asObject = body as Record<string, any>;
        message = asObject.message ?? exception.message;
        error = asObject.error ?? exception.name;
      }
      if (error === 'InternalServerError') error = exception.name;
    } else if (exception instanceof QueryFailedError) {
      const driver = exception as QueryFailedError & { code?: string; constraint?: string; detail?: string };
      const known = driver.constraint ? CONSTRAINT_MESSAGES[driver.constraint] : undefined;

      if (known) {
        status = known.status;
        message = known.message;
        error = 'ConstraintViolation';
      } else if (driver.code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'A record with these unique values already exists.';
        error = 'DuplicateRecord';
      } else if (driver.code === '23503') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Referenced record does not exist, or is still in use.';
        error = 'ForeignKeyViolation';
      } else if (driver.code === '23514') {
        status = HttpStatus.CONFLICT;
        message = 'The requested change violates a database business rule.';
        error = 'ConstraintViolation';
      } else if (driver.code === '40001' || driver.code === '40P01') {
        // Serialisation failure / deadlock: the caller may simply retry.
        status = HttpStatus.CONFLICT;
        message = 'Concurrent update detected, please retry the request.';
        error = 'SerializationFailure';
      } else {
        this.logger.error(`Unhandled DB error ${driver.code}: ${driver.message}`, driver.stack);
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} -> ${status}`, JSON.stringify(message));
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

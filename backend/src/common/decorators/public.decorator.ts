import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of JWT authentication.
 *
 * Authentication is deny-by-default: `JwtAuthGuard` is registered globally, so
 * a new controller is protected the moment it is written. Only routes that
 * explicitly carry @Public() (login, health) are reachable anonymously.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the listed roles.
 *
 * Read by `RolesGuard`, which is registered globally - so a route with no
 * @Roles() decorator is available to any authenticated user, and a route with
 * one is checked on the SERVER regardless of what the UI chose to render.
 *
 *   @Roles(Role.ADMIN)
 *   @Post()
 *   create(...) {}
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

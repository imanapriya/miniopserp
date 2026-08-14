import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../types';

/**
 * Global authorisation guard.
 *
 * This is the important half of "backend authorization is mandatory": the
 * frontend hides buttons a role cannot use, but that is only cosmetic. Every
 * restricted route is checked here, so a Sales user calling POST /work-orders
 * with curl and a perfectly valid token still gets a 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on the route: any authenticated user may call it.
    if (!required || required.length === 0) return true;

    const user: AuthUser = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Authentication required.');

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Role ${user.role} is not allowed to perform this operation. Required: ${required.join(' or ')}.`,
      );
    }
    return true;
  }
}

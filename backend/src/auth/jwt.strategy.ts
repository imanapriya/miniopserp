import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../database/entities';
import { AuthUser, JwtPayload } from '../common/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
    });
  }

  /**
   * Re-reads the user on every request rather than trusting the token body.
   *
   * It costs one indexed primary-key lookup, and in exchange a deactivated
   * account or a role change takes effect immediately instead of lingering
   * until the token expires.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account no longer active.');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      locationId: user.locationId,
    };
  }
}

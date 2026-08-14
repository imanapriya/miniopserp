import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { User } from '../database/entities';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthUser, JwtPayload } from '../common/types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    // passwordHash is `select: false` on the entity, so it has to be asked for
    // explicitly. That way it can never leak through an ordinary find().
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.location', 'location')
      .where('LOWER(u.email) = LOWER(:email)', { email: dto.email })
      .getOne();

    // Same message and roughly the same work for "no such user" and "wrong
    // password", so the endpoint cannot be used to enumerate valid emails.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const passwordMatches = await bcrypt.compare(dto.password, hash);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated.');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const expiresIn = this.config.get<string>('jwt.expiresIn');

    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        locationId: user.locationId,
        locationCode: user.location?.code ?? null,
      },
    };
  }

  /** Returns the caller's own profile, refreshed from the database. */
  async me(current: AuthUser) {
    const user = await this.users.findOne({
      where: { id: current.id },
      relations: { location: true },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      locationId: user.locationId,
      locationCode: user.location?.code ?? null,
    };
  }
}

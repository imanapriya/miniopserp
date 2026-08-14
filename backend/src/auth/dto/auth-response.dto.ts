import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums';

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty({ nullable: true, required: false }) locationId: string | null;
  @ApiProperty({ nullable: true, required: false }) locationCode?: string | null;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT bearer token. Send as `Authorization: Bearer <token>`.' })
  accessToken: string;

  @ApiProperty({ example: '8h' })
  expiresIn: string;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

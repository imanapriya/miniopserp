import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'admin@ops-erp.local' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'A valid email address is required.' })
  email: string;

  @ApiProperty({ example: 'Password@123', minLength: 6 })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters.' })
  password: string;
}

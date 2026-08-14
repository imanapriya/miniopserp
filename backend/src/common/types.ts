import { Role } from './enums';

/** The shape the JWT strategy puts on `request.user`. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  locationId: string | null;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

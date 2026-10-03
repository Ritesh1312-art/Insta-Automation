// A valid cost-12 hash used only to keep bcrypt work comparable when there is
// no eligible account. It is not an account credential and must never be used
// to create or update a user's password hash.
export const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.UYx4O6iGzYQY4qk6z9dN9l9h3dQWn9G';

export function isBcryptPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

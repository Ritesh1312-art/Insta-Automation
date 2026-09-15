export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 20;
export const PASSWORD_POLICY_MESSAGE =
  'Password must be 10–20 characters and include at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.';
export const PASSWORD_POLICY_PATTERN =
  '(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s]).{10,20}';

/**
 * One shared password policy for the browser, API routes, and admin CLI.
 * Whitespace is accepted as a special character only when another non-letter,
 * non-number character is also present, which avoids invisible passwords.
 */
export function validatePassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return false;
  return (
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password)
  );
}

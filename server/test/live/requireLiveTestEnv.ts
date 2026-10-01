/**
 * Reads a variable a live API test needs, such as an API key. Throws instead
 * of letting the test skip, since live tests only run where they've been
 * configured and a silent skip would hide a broken setup.
 */
export function requireLiveTestEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set to run live API tests`);
  }
  return value;
}

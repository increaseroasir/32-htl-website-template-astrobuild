/**
 * Length-independent secret comparison (C18 / L-03). ONE shape for every
 * secret check in the template: the stage webhook used this from day one;
 * the admin password now does too instead of `!==`, whose early exit leaks
 * how much of a guess matched through response timing. Length still
 * short-circuits — length is not the secret.
 *
 * Pure module on purpose: no Workers imports, so the lib harness can prove
 * the comparator without a runtime.
 */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

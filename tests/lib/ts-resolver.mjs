/**
 * Resolve `./x` as `./x.ts`, then as `./x/index.ts`, when the bare form
 * fails — the two shapes TS files in this repo actually use. See register.mjs.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Only retry relative specifiers that failed to resolve. Note a name
    // like './client.config' LOOKS extensioned but is not — so the retry is
    // attempted on any not-found, not gated on a suffix guess.
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && !specifier.endsWith('.ts')) {
      try {
        return await nextResolve(`${specifier}.ts`, context);
      } catch {
        try {
          return await nextResolve(`${specifier}/index.ts`, context);
        } catch {
          throw error;
        }
      }
    }
    throw error;
  }
}

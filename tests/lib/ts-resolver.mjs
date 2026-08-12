/** Resolve `./x` as `./x.ts` when the bare form fails. See register.mjs. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const extensionless = !/\.[a-zA-Z]+$/.test(specifier);
    if (relative && extensionless) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}

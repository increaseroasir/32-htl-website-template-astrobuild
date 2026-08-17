/**
 * Test-runner bootstrap: lets `node --test` import the template's TypeScript
 * modules directly. Node 22 strips types natively; the one thing it does NOT
 * do is resolve the extensionless relative imports TS files use
 * (`import ... from './hash'`). The resolver hook retries those with `.ts`.
 *
 * Zero dependencies on purpose — the lib harness must never be the reason a
 * fresh clone fails.
 */
import { register } from 'node:module';

register(new URL('./ts-resolver.mjs', import.meta.url));

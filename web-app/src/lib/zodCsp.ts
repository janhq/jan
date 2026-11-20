import { config } from 'zod'

// zod v4 compiles object schemas with `new Function` unless told not to. The
// window CSP has no 'unsafe-eval', so its probe would only throw and log a
// violation before falling back to the interpreter this selects up front.
// Imported first in main.tsx so it is set before any schema parses.
config({ jitless: true })

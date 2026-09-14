import { join } from 'node:path'

/**
 * Environment that confines the app's on-disk state to `home`.
 *
 * Its own module, with no side effects, so specs can assert on it without
 * re-evaluating wdio.conf.ts (which creates the temp profile at import time).
 *
 * On Linux every XDG base directory is pinned, not just the ones Jan is known to
 * read today. Each outranks its `$HOME`-relative default, so any single one
 * inherited from the outer environment silently defeats the HOME override -- and
 * "the ones that matter" is a list that rots as the app changes.
 *
 * `XDG_CONFIG_HOME` is why this is belt-and-braces rather than minimal, and the
 * stakes are destructive rather than untidy. `dirs::config_dir()` feeds the
 * legacy-config migration in core/app/commands.rs, which runs on every fresh
 * profile and does `fs::copy` followed by `fs::remove_file`. With that variable
 * inherited, a run DELETES the developer's real ~/.config/Jan/settings.json.
 * Confirmed against a decoy: the file did not survive one run.
 *
 * Deliberately absent:
 * - XDG_DATA_DIRS / XDG_CONFIG_DIRS: read-only system paths; overriding them
 *   breaks GTK schema and theme lookup.
 * - XDG_RUNTIME_DIR: the app needs the real one for D-Bus. It cannot be
 *   isolated, which is an accepted gap rather than an oversight.
 */
export function isolationEnv(home: string): Record<string, string> {
  if (process.platform !== 'linux') return { HOME: home }
  return {
    HOME: home,
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_CACHE_HOME: join(home, '.cache'),
  }
}

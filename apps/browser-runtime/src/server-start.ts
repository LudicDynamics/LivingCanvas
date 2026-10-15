// Did the in-tab server start? Its program's top level ends with `server.listen()`
// (apps/server/src/index.ts); when that top level has finished and no server is
// registered, the program died on the way and booting must fail with why.

/** null = started; else the boot error. `stopped` is what runProgram's `main` resolved with. */
export function serverStartFailure(server: unknown, stopped: string | null): string | null {
  if (server) return null;
  return `server exited before listen()${stopped ? `: ${stopped}` : ' (its top level ended without listening)'}`;
}

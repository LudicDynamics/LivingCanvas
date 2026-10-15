// node:path (posix). path-browserify reads the free `process` identifier for
// `resolve()`, so each program bundle gets its own copy bound to its own cwd.
import posix from 'path-browserify';

const p: any = { ...posix };
p.sep = '/';
p.delimiter = ':';
p.toNamespacedPath = (s: string) => s;
p.matchesGlob = () => false;
p.posix = p;
p.win32 = p;
export default p;
export const {
  resolve, normalize, isAbsolute, join, relative, dirname, basename, extname, format, parse,
  sep, delimiter, toNamespacedPath, win32, matchesGlob,
} = p;
export const posixPath = p;
export { p as posix };

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

const root = process.env.SUNHAT_TEST_PROJECT_ROOT;
const toolchains = resolve(root, '.sunhat/toolchains');
const destination = resolve(toolchains, process.env.SUNHAT_TEST_TARGET);
const lock = resolve(root, '.sunhat/toolchain.json');
const mode = process.env.SUNHAT_TEST_INSTALL_FAULT;
const rename = fs.renameSync;
const write = fs.writeFileSync;

function inside(parent, path) {
  const child = relative(parent, path);
  return !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
}

// Model separate mounts for OS temp, project metadata and the toolchains folder.
function device(path) { return inside(toolchains, path) ? 'toolchains' : inside(root, path) ? 'project' : 'os-temp'; }
function failure(code) { return Object.assign(new Error(`injected ${mode} failure (${code})`), { code }); }

fs.renameSync = (from, to) => {
  fs.appendFileSync(process.env.SUNHAT_TEST_RENAME_LOG, `${JSON.stringify({ from, to })}\n`);
  if (mode === 'cross-device' && device(from) !== device(to)) throw failure('EXDEV');
  const restoring = basename(from) === 'previous';
  if ((mode === 'activate' || mode === 'rollback') && inside(destination, to) && !inside(destination, from) && !restoring) throw failure('EIO');
  if (mode === 'rollback' && restoring) throw failure('EACCES');
  if (mode === 'lock' && to === lock) throw failure('EIO');
  return rename(from, to);
};

fs.writeFileSync = (path, ...args) => {
  // Also fail the old direct-write implementation, before it can truncate its lock.
  if (mode === 'lock' && path === lock) throw failure('EIO');
  return write(path, ...args);
};

syncBuiltinESMExports();

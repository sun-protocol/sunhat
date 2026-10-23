import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, usage } from '../errors.js';
import type { Framework, Target } from '../project/binding.js';
import { parseTarget } from '../cli/parser.js';

interface InitOptions { framework: Framework; target?: Target; path: string; adopt: boolean }
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function initProject(argv: readonly string[]): number {
  const options = parseOptions(argv);
  const { framework } = options;
  const root = resolve(options.path); mkdirSync(root, { recursive: true });
  if (existsSync(resolve(root, 'sunhat.toml'))) return usage(`${root} is already bound by sunhat.toml`);
  const target = options.adopt ? inferTarget(root, framework, options.target) : requiredTarget(options.target);
  if (options.adopt) validateNativeProject(root, framework);
  else scaffold(root, framework, target);
  writeExclusive(resolve(root, 'sunhat.toml'), `[project]\nframework = "${framework}"\ntarget = "${target}"\n`);
  process.stderr.write(`${options.adopt ? 'adopted' : 'initialized'} ${framework}/${target} project at ${root}\n`);
  return 0;
}
function parseOptions(argv: readonly string[]): InitOptions {
  let framework: Framework = 'foundry'; let target: Target | undefined; let path = '.'; let positional = false; let adopt = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--framework') {
      const value = argv[++i];
      if (value !== 'foundry' && value !== 'hardhat') return usage('--framework requires foundry or hardhat');
      framework = value;
    }
    else if (arg === '--target') { const value = argv[++i]; if (!value) return usage('--target requires tron or evm'); target = parseTarget(value); }
    else if (arg === '--adopt') adopt = true;
    else if (arg === '-h' || arg === '--help') { process.stdout.write('Usage: sunhat init [--framework <foundry|hardhat>] --target <tron|evm> [--adopt] [path]\n'); return process.exit(0) as never; }
    else if (arg.startsWith('-')) return usage(`unknown init option ${arg}`);
    else { if (positional) return usage('init accepts at most one path'); path = arg; positional = true; }
  }
  return target ? { framework, target, path, adopt } : { framework, path, adopt };
}
function requiredTarget(target: Target | undefined): Target { return target ?? usage('new projects require --target tron or --target evm'); }
function validateNativeProject(root: string, framework: Framework): void {
  const found = framework === 'foundry' ? existsSync(resolve(root, 'foundry.toml')) : ['js', 'cjs', 'ts'].some(ext => existsSync(resolve(root, `hardhat.config.${ext}`)));
  if (!found) throw new CliError(`cannot adopt ${framework}: native configuration not found in ${root}`, 2);
}
function inferTarget(root: string, framework: Framework, explicit: Target | undefined): Target {
  if (explicit) return explicit;
  validateNativeProject(root, framework);
  const names = framework === 'foundry' ? ['foundry.toml', 'package.json'] : ['hardhat.config.js', 'hardhat.config.cjs', 'hardhat.config.ts', 'package.json'];
  const text = names.filter(name => existsSync(resolve(root, name))).map(name => readFileSync(resolve(root, name), 'utf8')).join('\n');
  if (/hardhat-tron|foundry-tron|\btron\b/iu.test(text)) return 'tron';
  if (/hardhat|\[profile\.|solc_version|evm_version/iu.test(text)) return 'evm';
  return usage('target cannot be inferred uniquely; pass --target tron or --target evm');
}
function scaffold(root: string, framework: Framework, target: Target): void {
  const source = resolve(packageRoot, 'templates', framework);
  const destinations = framework === 'hardhat'
    ? ['package.json', 'hardhat.config.ts', 'contracts/Counter.sol', 'scripts/deploy.ts', 'test/Counter.test.ts', 'tsconfig.json']
    : ['package.json', 'foundry.toml', 'src/Counter.sol', 'script/Counter.s.sol', 'test/Counter.t.sol'];
  const conflict = destinations.find(name => existsSync(resolve(root, name)));
  if (conflict) throw new CliError(`refusing to overwrite existing file ${resolve(root, conflict)}`, 2);
  if (framework === 'hardhat') {
    writeExclusive(resolve(root, 'package.json'), `${JSON.stringify(hardhatPackage(root, target), null, 2)}\n`);
    writeExclusive(resolve(root, 'hardhat.config.ts'), hardhatConfig(target));
    for (const name of ['contracts/Counter.sol', 'scripts/deploy.ts', 'test/Counter.test.ts', 'tsconfig.json']) copyExclusive(resolve(source, name), resolve(root, name));
  } else {
    writeExclusive(resolve(root, 'package.json'), `${JSON.stringify(foundryPackage(root, target), null, 2)}\n`);
    writeExclusive(resolve(root, 'foundry.toml'), foundryConfig(target));
    for (const name of ['src/Counter.sol', 'script/Counter.s.sol', 'test/Counter.t.sol']) copyExclusive(resolve(source, name), resolve(root, name));
  }
}
function hardhatPackage(root: string, target: Target): object {
  const dependencies: Record<string, string> = { '@nomicfoundation/hardhat-chai-matchers': '2.0.0', '@nomicfoundation/hardhat-ethers': '3.0.0', '@types/chai': '4.3.0', '@types/mocha': '10.0.0', chai: '4.5.0', ethers: '6.13.0', hardhat: '2.29.1', 'ts-node': '10.9.2', typescript: '5.6.3' };
  if (target === 'tron') dependencies['@openzeppelin/hardhat-tron'] = '0.1.0';
  dependencies.sunhat = sunhatDependency();
  return { name: basename(root), version: '0.1.0', private: true, scripts: { build: 'sunhat compile', test: 'sunhat test' }, devDependencies: dependencies };
}
function foundryPackage(root: string, target: Target): object {
  return {
    name: basename(root), version: '0.1.0', private: true,
    scripts: { build: 'sunhat build', test: 'sunhat test' },
    devDependencies: { sunhat: sunhatDependency() },
    sunhat: { foundryToolchain: { target, source: target === 'tron' ? 'elsvv/foundry-tron' : 'foundry-rs/foundry' } },
  };
}
function sunhatDependency(): string {
  return `file:${packageRoot}`;
}
function hardhatConfig(target: Target): string {
  const plugin = target === 'tron' ? 'import "@openzeppelin/hardhat-tron";\n' : '';
  return `${plugin}import "@nomicfoundation/hardhat-ethers";\nimport "@nomicfoundation/hardhat-chai-matchers";\nimport type { HardhatUserConfig } from "hardhat/config";\nconst config: HardhatUserConfig = { solidity: "0.8.26" };\nexport default config;\n`;
}
function foundryConfig(target: Target): string {
  const network = target === 'tron' ? 'network = "tron"\nchain_id = 728126428\nevm_version = "cancun"\n' : '';
  return `[profile.default]\nsrc = "src"\nout = "out"\nlibs = ["lib"]\n${network}`;
}
function copyExclusive(from: string, to: string): void { writeExclusive(to, readFileSync(from)); }
function writeExclusive(path: string, data: string | Buffer): void { mkdirSync(dirname(path), { recursive: true }); try { writeFileSync(path, data, { flag: 'wx' }); } catch (error) { throw new CliError(`refusing to overwrite existing file ${path}`, 2); } }

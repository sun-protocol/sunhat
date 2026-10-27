import type { Target } from '../project/binding.js';
import { toolchainError } from '../errors.js';
export interface Release { source: string; release: string; revision: string; archive: string; sha256: string; tools: Record<'forge' | 'cast' | 'anvil' | 'chisel', string> }
type Platform = 'darwin-arm64' | 'darwin-amd64' | 'linux-arm64' | 'linux-amd64' | 'win32-amd64';
const EVM_SHA: Record<Platform, string> = {
  'darwin-arm64': 'd6bc05ee937b4308bded496068728c8ba140abe49dd7527f37e025bc335b91ec', 'darwin-amd64': 'c0b032cdfda5fdce75ab6b782785f3f28aaf431bd55daecfb6437d01369f235e',
  'linux-arm64': 'ca61f3f6e7d635f34e3e174409964d29126fa135794cd84cead8919dd50e0930', 'linux-amd64': '58850106984038f3a7200f38a4182c8cb423d3a4f4c7848eacbc2453e6bc35fc',
  'win32-amd64': '924d6395786af438e7cb315f6835185f99d727ed6127dbbc4e6a62eb14edcfff',
};
const TRON_SHA: Record<Platform, string> = {
  'darwin-arm64': 'b40d08504352475c937cc66bd69eacd35f9ac580abd55d5b294e5cbd0e23cf31', 'darwin-amd64': 'dc2c3f22ec2292885d41617105a5356946bf3efa1d9736ea5d5fd68b802a937a',
  'linux-arm64': '4f2dbe50848d21708e44b2dde168298fa468d8fed0a6ebca0fe9e22ad0f0c27c', 'linux-amd64': '7d684c883b72cc407fef77eab90c9304b5bdd310a465f18e8fd199e595e04331',
  'win32-amd64': 'c257cef8478334544521e3d6f1da58eaecc21ece8b404dea96831156d9979cc4',
};
export function platformKey(): Platform {
  const key = `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  if (!(key in EVM_SHA)) return toolchainError(`unsupported Foundry platform ${process.platform}-${process.arch}`);
  return key as Platform;
}
export function releaseFor(target: Target): Release {
  const platform = platformKey(); const extension = platform.startsWith('win32') ? 'zip' : 'tar.gz';
  const executableExtension = platform.startsWith('win32') ? '.exe' : '';
  if (target === 'evm') return { source: 'foundry-rs/foundry', release: 'v1.8.6', revision: 'v1.8.6', archive: `foundry_v1.8.6_${platform.replace('-', '_')}.${extension}`, sha256: EVM_SHA[platform], tools: { forge: `forge${executableExtension}`, cast: `cast${executableExtension}`, anvil: `anvil${executableExtension}`, chisel: `chisel${executableExtension}` } };
  return { source: 'elsvv/foundry-tron', release: 'foundry-tron-latest', revision: '9ea07db4b342fd606f6f7c3f99be1757e90d5e90', archive: `foundry-tron_${platform.replace('-', '_')}.${extension}`, sha256: TRON_SHA[platform], tools: { forge: `forge-tron${executableExtension}`, cast: `cast-tron${executableExtension}`, anvil: `anvil-tron${executableExtension}`, chisel: `chisel-tron${executableExtension}` } };
}
export function releaseUrl(release: Release): string { return `https://github.com/${release.source}/releases/download/${release.release}/${release.archive}`; }

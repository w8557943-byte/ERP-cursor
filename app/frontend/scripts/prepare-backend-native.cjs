const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendDir = path.resolve(__dirname, '../../backend');
const lockFile = path.join(backendDir, 'package-lock.json');
const sqliteMainBinary = path.join(
  backendDir,
  'node_modules',
  'sqlite3',
  'build',
  'Release',
  'node_sqlite3.node'
);

const targetPlatform = String(
  process.env.TARGET_PLATFORM || process.env.npm_config_platform || process.platform
).toLowerCase();
const targetArch = String(
  process.env.TARGET_ARCH || process.env.npm_config_arch || process.arch
).toLowerCase();

function run(cmd) {
  execSync(cmd, { cwd: backendDir, stdio: 'inherit' });
}

function parseBinaryInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 64) return { format: 'unknown', arch: 'unknown' };

  // PE/COFF (Windows)
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const peOffset = buf.readUInt32LE(0x3c);
    if (peOffset + 6 < buf.length && buf[peOffset] === 0x50 && buf[peOffset + 1] === 0x45) {
      const machine = buf.readUInt16LE(peOffset + 4);
      const archMap = {
        0x14c: 'ia32',
        0x8664: 'x64',
        0xaa64: 'arm64'
      };
      return { format: 'pe', arch: archMap[machine] || `unknown(0x${machine.toString(16)})` };
    }
    return { format: 'pe', arch: 'unknown' };
  }

  // Mach-O magic
  const magic = buf.readUInt32BE(0);
  if ([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)) {
    return { format: 'macho', arch: 'unknown' };
  }

  // ELF magic
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    const elfClass = buf[4] === 2 ? 'x64' : (buf[4] === 1 ? 'ia32' : 'unknown');
    return { format: 'elf', arch: elfClass };
  }

  return { format: 'unknown', arch: 'unknown' };
}

function assertSQLiteBinary() {
  if (!fs.existsSync(sqliteMainBinary)) {
    throw new Error(`sqlite3 二进制不存在: ${sqliteMainBinary}`);
  }

  const info = parseBinaryInfo(sqliteMainBinary);
  console.log(`[prepare-backend-native] sqlite3 binary: ${sqliteMainBinary}`);
  console.log(`[prepare-backend-native] detected format=${info.format}, arch=${info.arch}`);
  console.log(`[prepare-backend-native] target   platform=${targetPlatform}, arch=${targetArch}`);

  if (targetPlatform === 'win32' && info.format !== 'pe') {
    throw new Error(
      `当前 sqlite3 不是 Windows PE 二进制（检测到 ${info.format}）。` +
      '请在 Windows x64 环境打包，或先生成 Windows 对应的 backend/node_modules。'
    );
  }

  if (targetPlatform === 'win32' && targetArch === 'x64' && info.arch !== 'x64') {
    throw new Error(
      `sqlite3 架构不匹配：目标是 x64，实际是 ${info.arch}。` +
      '请在 Windows x64 环境重新安装 backend 依赖后再打包。'
    );
  }
}

function main() {
  const installCmd = fs.existsSync(lockFile) ? 'npm ci --omit=dev' : 'npm install --omit=dev';
  run(installCmd);
  run('npm rebuild sqlite3 --update-binary');
  assertSQLiteBinary();
}

main();

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

  if (targetPlatform === 'win32') {
    if (info.format !== 'pe') {
      throw new Error(
        `当前 sqlite3 不是 Windows PE 二进制（检测到 ${info.format}）。` +
        '请在 Windows x64 环境打包，或先生成 Windows 对应的 backend/node_modules。'
      );
    }

    if (targetArch === 'x64' && info.arch !== 'x64') {
      throw new Error(
        `sqlite3 架构不匹配：目标是 x64，实际是 ${info.arch}。` +
        '请在 Windows x64 环境重新安装 backend 依赖后再打包。'
      );
    }
  }

  if (targetPlatform === 'darwin') {
    if (info.format !== 'macho') {
      console.warn(`[prepare-backend-native] 警告: sqlite3 可能不是正确的 Mach-O 格式`);
    }
    
    const currentArch = process.arch;
    const isUniversal = info.arch === 'universal';
    const archMatch = isUniversal || info.arch === currentArch || 
                      (targetArch === 'x64' && info.arch === 'x86_64') ||
                      (targetArch === 'arm64' && info.arch === 'arm64');
    
    if (!archMatch && targetArch !== 'universal') {
      console.warn(`[prepare-backend-native] 警告: sqlite3 架构(${info.arch})与目标(${targetArch})可能不匹配`);
      console.warn(`[prepare-backend-native] 当前系统架构: ${currentArch}`);
    }
  }
}

function installElectronRebuild() {
  const rebuildPkg = path.join(backendDir, 'node_modules', '@electron', 'rebuild');
  if (!fs.existsSync(rebuildPkg)) {
    console.log('[prepare-backend-native] installing @electron/rebuild...');
    execSync('npm install -D @electron/rebuild', { cwd: backendDir, stdio: 'inherit' });
  }
}

function createUniversalBinary() {
  const releaseDir = path.join(backendDir, 'node_modules', 'sqlite3', 'build', 'Release');
  const x64Binary = path.join(releaseDir, 'node_sqlite3_x64.node');
  const arm64Binary = path.join(releaseDir, 'node_sqlite3_arm64.node');
  const universalBinary = path.join(releaseDir, 'node_sqlite3.node');
  
  if (!fs.existsSync(x64Binary) || !fs.existsSync(arm64Binary)) {
    console.log('[prepare-backend-native] arch binaries not found, combining...');
    return;
  }
  
  execSync(`lipo -create -output "${universalBinary}" "${x64Binary}" "${arm64Binary}"`, { stdio: 'inherit' });
  fs.unlinkSync(x64Binary);
  fs.unlinkSync(arm64Binary);
  console.log('[prepare-backend-native] created universal binary');
}

function renameForArch(arch) {
  const releaseDir = path.join(backendDir, 'node_modules', 'sqlite3', 'build', 'Release');
  const src = path.join(releaseDir, 'node_sqlite3.node');
  const dst = path.join(releaseDir, `node_sqlite3_${arch}.node`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`[prepare-backend-native] copied to ${arch}`);
  }
}

function ensureCorrectArch() {
  const releaseDir = path.join(backendDir, 'node_modules', 'sqlite3', 'build', 'Release');
  const currentArch = process.arch;
  const arm64File = path.join(releaseDir, 'node_sqlite3_arm64.node');
  const x64File = path.join(releaseDir, 'node_sqlite3_x64.node');
  const defaultFile = path.join(releaseDir, 'node_sqlite3.node');
  
  if (currentArch === 'arm64' && fs.existsSync(arm64File)) {
    if (fs.existsSync(defaultFile)) fs.unlinkSync(defaultFile);
    fs.copyFileSync(arm64File, defaultFile);
    console.log('[prepare-backend-native] using arm64 sqlite3 for current platform');
  } else if (currentArch === 'x64' && fs.existsSync(x64File)) {
    if (fs.existsSync(defaultFile)) fs.unlinkSync(defaultFile);
    fs.copyFileSync(x64File, defaultFile);
    console.log('[prepare-backend-native] using x64 sqlite3 for current platform');
  }
}

function main() {
  const installCmd = fs.existsSync(lockFile) ? 'npm ci --omit=dev' : 'npm install --omit=dev';
  run(installCmd);
  installElectronRebuild();
  const frontendDir = path.resolve(__dirname, '..');
  const electronPath = path.join(frontendDir, 'node_modules', 'electron');
  
  if (targetPlatform === 'darwin') {
    if (targetArch === 'arm64' || targetArch === 'universal') {
      run(`node "./node_modules/@electron/rebuild/lib/cli.js" -f -w sqlite3 -e "${electronPath}" -a arm64 --build-from-source`);
      renameForArch('arm64');
    }
    if (targetArch === 'x64' || targetArch === 'universal') {
      run(`node "./node_modules/@electron/rebuild/lib/cli.js" -f -w sqlite3 -e "${electronPath}" -a x64 --build-from-source`);
      renameForArch('x64');
    }
    if (targetArch === 'universal') {
      createUniversalBinary();
    }
  } else {
    run(`node "./node_modules/@electron/rebuild/lib/cli.js" -f -w sqlite3 -e "${electronPath}" --build-from-source`);
  }
  
  ensureCorrectArch();
}

main();

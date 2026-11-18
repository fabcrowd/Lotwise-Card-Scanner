import { spawn, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installerDir = path.join(repoRoot, 'tools', 'installer');
const installScript = path.join(installerDir, 'install.ps1');
const uninstallScript = path.join(installerDir, 'uninstall.ps1');
const win32 = { skip: process.platform !== 'win32' };
const KEY_PARENT = 'HKCU:\\Software\\LotwiseInstallerTest';
// install.ps1 exits 0 when installed, and this code when it failed after showing its own message.
const EXIT_SHOWN_FAILURE = 3;
const CHROME_SENTENCE ='If Chrome is open, close it and run Lotwise Setup again.';

function powershell(args, options = {}) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8', ...options });
}

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// Builds a package zip from a map of relative path to content.
function makeZip(base, name, files) {
  const source = path.join(base, `${name}-src`);
  for (const [relative, content] of Object.entries(files)) writeFile(path.join(source, relative), content);
  const zip = path.join(base, `${name}.zip`);
  const result = powershell(['-Command', `Compress-Archive -Path '${source}\\*' -DestinationPath '${zip}' -Force`]);
  assert.equal(result.status, 0, result.stderr);
  return zip;
}

function regValue(key, name) {
  const result = spawnSync('reg', ['query', key.replace('HKCU:\\', 'HKCU\\'), '/v', name], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const match = result.stdout.match(new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*)$`, 'm'));
  return match ? match[1].trim() : null;
}

function keyExists(key) {
  return spawnSync('reg', ['query', key.replace('HKCU:\\', 'HKCU\\')], { encoding: 'utf8' }).status === 0;
}

function removeTestKeys(key) {
  powershell(['-Command', `Remove-Item -LiteralPath '${key}' -Recurse -Force -ErrorAction SilentlyContinue; ` +
    `if ((Test-Path '${KEY_PARENT}') -and -not (Get-ChildItem '${KEY_PARENT}')) { Remove-Item '${KEY_PARENT}' -Force }`]);
}

// Matches System.Net.WebUtility.HtmlEncode, which the installer uses.
function htmlEncode(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function waitUntil(condition, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (!condition() && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  return condition();
}

// Each case gets a temp folder with a space in its name and its own registry key.
function withSandbox(run, rootName = 'install root') {
  const base = mkdtempSync(path.join(tmpdir(), 'lotwise test '));
  const root = path.join(base, rootName);
  const key = `${KEY_PARENT}\\${randomBytes(6).toString('hex')}`;
  const install = (zip, version) => powershell([
    '-File', installScript, '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key, '-PackageZip', zip, '-Version', version,
  ]);
  const uninstall = () => powershell(['-File', path.join(root, 'uninstall.ps1'), '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key]);
  try {
    run({ base, root, key, install, uninstall });
  } finally {
    // The key goes first so a folder that cannot be deleted still never leaves a registry entry behind.
    removeTestKeys(key);
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

const baseFiles = { 'manifest.json': '{"version":"1"}', 'icons/x.txt': 'x', 'lib/a.js': 'a' };

test('a fresh install expands the package, writes the guide and the uninstall entry', win32, () => {
  withSandbox(({ base, root, key, install }) => {
    const zip = makeZip(base, 'pkg1', baseFiles);
    const result = install(zip, '9.8.7');
    assert.equal(result.status, 0, result.stderr);

    const extension = path.join(root, 'extension');
    assert.ok(existsSync(path.join(extension, 'manifest.json')));
    assert.ok(existsSync(path.join(extension, 'icons', 'x.txt')));
    assert.ok(existsSync(path.join(extension, 'lib', 'a.js')));
    assert.ok(existsSync(path.join(root, 'uninstall.ps1')));

    const guide = readFileSync(path.join(root, 'guide.html'), 'utf8');
    assert.ok(guide.includes(htmlEncode(extension)));
    assert.ok(guide.includes('9.8.7'));
    assert.ok(!guide.includes('{{'));

    assert.equal(regValue(key, 'DisplayName'), 'Lotwise card scanner (Chrome extension)');
    assert.equal(regValue(key, 'DisplayVersion'), '9.8.7');
    assert.equal(regValue(key, 'Publisher'), 'fabcrowd');
    const uninstallString = regValue(key, 'UninstallString');
    assert.ok(uninstallString.includes(path.join(root, 'uninstall.ps1')));
    assert.ok(uninstallString.includes(`-InstallRoot "${root}"`));
    assert.ok(uninstallString.includes(`-UninstallKey "${key}"`));
  });
});

test('the packaged layout reads version.txt and lotwise-extension.zip beside the script', win32, () => {
  withSandbox(({ base, root, key }) => {
    const packaged = path.join(base, 'packaged');
    mkdirSync(packaged);
    for (const name of ['install.ps1', 'uninstall.ps1', 'guide.html']) copyFileSync(path.join(installerDir, name), path.join(packaged, name));
    writeFileSync(path.join(packaged, 'version.txt'), '4.5.6');
    copyFileSync(makeZip(base, 'fixture', baseFiles), path.join(packaged, 'lotwise-extension.zip'));

    const result = powershell(['-File', path.join(packaged, 'install.ps1'), '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(path.join(root, 'guide.html'), 'utf8').includes('4.5.6'));
    assert.equal(regValue(key, 'DisplayVersion'), '4.5.6');
  });
});

test('an install root with a space, an ampersand and an apostrophe works end to end', win32, () => {
  withSandbox(({ base, root, install, uninstall }) => {
    const result = install(makeZip(base, 'pkg1', baseFiles), '1.0.0');
    assert.equal(result.status, 0, result.stderr);

    const extension = path.join(root, 'extension');
    const guide = readFileSync(path.join(root, 'guide.html'), 'utf8');
    assert.ok(guide.includes(htmlEncode(extension)));
    assert.ok(guide.includes('&amp;'));
    assert.ok(guide.includes('&#39;'));
    assert.ok(!guide.includes(extension));
    assert.ok(!guide.includes("Tom & Co"));

    const removal = uninstall();
    assert.equal(removal.status, 0, removal.stderr);
    // The detached cmd line deletes the script and the folder after this process exits.
    const gone = waitUntil(() => !existsSync(path.join(root, 'uninstall.ps1')) && !existsSync(root), 15);
    assert.ok(gone, 'uninstall.ps1 and the install root were not removed within 15 seconds');
  }, "Tom & Co's Lotwise");
});

test('installing again replaces the files and leaves no leftover folders', win32, () => {
  withSandbox(({ base, root, install }) => {
    const first = makeZip(base, 'pkg1', { ...baseFiles, 'only-first.txt': '1' });
    const second = makeZip(base, 'pkg2', { ...baseFiles, 'only-second.txt': '2' });
    assert.equal(install(first, '1.0.0').status, 0);
    assert.equal(install(second, '1.0.1').status, 0);

    assert.ok(!existsSync(path.join(root, 'extension', 'only-first.txt')));
    assert.ok(existsSync(path.join(root, 'extension', 'only-second.txt')));
    assert.ok(!existsSync(path.join(root, 'extension.old')));
    assert.ok(!existsSync(path.join(root, 'extension.new')));
  });
});

test('a package without manifest.json fails and leaves the existing install alone', win32, () => {
  withSandbox(({ base, root, install }) => {
    assert.equal(install(makeZip(base, 'good', { ...baseFiles, 'keep.txt': 'k' }), '1.0.0').status, 0);
    const bad = makeZip(base, 'bad', { 'lib/a.js': 'a' });
    const result = install(bad, '2.0.0');

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('manifest.json'), result.stderr);
    assert.ok(existsSync(path.join(root, 'extension', 'manifest.json')));
    assert.ok(existsSync(path.join(root, 'extension', 'keep.txt')));
    assert.ok(!existsSync(path.join(root, 'extension.new')));
  });
});

test('a failed folder swap rolls back to the first install and tells the user to close Chrome', win32, () => {
  withSandbox(({ base, root, key, install }) => {
    assert.equal(install(makeZip(base, 'good', { ...baseFiles, 'keep.txt': 'k' }), '1.0.0').status, 0);
    // An open file inside the folder stops Windows from renaming it, as an open Chrome would.
    const handle = openSync(path.join(root, 'extension', 'lib', 'a.js'), 'r');
    try {
      const result = install(makeZip(base, 'next', { ...baseFiles, 'only-second.txt': '2' }), '2.0.0');
      assert.notEqual(result.status, 0, 'the reinstall should fail while a file is held open');
      assert.ok(result.stderr.trim().endsWith(CHROME_SENTENCE), result.stderr);
      assert.ok(existsSync(path.join(root, 'extension', 'keep.txt')));
      assert.ok(!existsSync(path.join(root, 'extension', 'only-second.txt')));
      assert.equal(regValue(key, 'DisplayVersion'), '1.0.0');
      assert.ok(!existsSync(path.join(root, 'extension.old')));
      assert.ok(!existsSync(path.join(root, 'extension.new')));
    } finally {
      closeSync(handle);
    }
  });
});

test('uninstall removes the extension folder, the guide and the registry key', win32, () => {
  withSandbox(({ base, root, key, install, uninstall }) => {
    assert.equal(install(makeZip(base, 'pkg1', baseFiles), '1.0.0').status, 0);
    assert.ok(keyExists(key));

    const result = uninstall();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(path.join(root, 'extension')));
    assert.ok(!existsSync(path.join(root, 'guide.html')));
    assert.ok(!keyExists(key));
  });
});

test('uninstall refuses folders that are not a complete Lotwise install', win32, () => {
  withSandbox(({ base, key }) => {
    const unrelated = path.join(base, 'unrelated');
    writeFile(path.join(unrelated, 'notes.txt'), 'mine');
    let result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', unrelated, '-UninstallKey', key]);
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(path.join(unrelated, 'notes.txt')));

    const lookalike = path.join(base, 'lookalike');
    writeFile(path.join(lookalike, 'uninstall.ps1'), 'not ours');
    writeFile(path.join(lookalike, 'other.txt'), 'mine');
    result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', lookalike, '-UninstallKey', key]);
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(path.join(lookalike, 'uninstall.ps1')));
    assert.ok(existsSync(path.join(lookalike, 'other.txt')));

    const noScript = path.join(base, 'no-script');
    writeFile(path.join(noScript, 'extension', 'manifest.json'), '{}');
    result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', noScript, '-UninstallKey', key]);
    assert.notEqual(result.status, 0);
    assert.ok(existsSync(path.join(noScript, 'extension', 'manifest.json')));
  });
});

// Runs only the named guard functions of a script, taken from its real source, on one input in a child process.
// The functions only validate a string or a path, so nothing is installed or removed. The input travels in an
// environment variable so an empty string survives. Exit 0 means accepted, 3 means the function threw.
function runGuard(file, names, call, input) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lotwise guard '));
  try {
    const harness = path.join(dir, 'harness.ps1');
    const body = names.map((name) => functionText(file, name)).join('\n');
    writeFileSync(harness, `$ErrorActionPreference = 'Stop'\n${body}\ntry { ${call} } catch { [Console]::Out.WriteLine('REFUSED: ' + $_.Exception.Message); exit 3 }\n`);
    return powershell(['-File', harness], { env: { ...process.env, LOTWISE_GUARD_INPUT: input } });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

test('both scripts refuse a drive root, a share root and a path that is not full, without touching anything', win32, () => {
  const acceptable = path.join(tmpdir(), 'lotwise install root');
  for (const file of [installScript, uninstallScript]) {
    for (const bad of ['C:', 'C:\\', 'C:\\.', 'D:\\', 'C:\\foo\\..', 'C:\\..', '\\\\?\\C:\\', '\\\\.\\C:\\', 'relative-root', '', '\\\\127.0.0.1\\nosuchshare\\', '\\\\127.0.0.1\\nosuchshare']) {
      const result = runGuard(file, ['Resolve-InstallRoot'], "[Console]::Out.WriteLine((Resolve-InstallRoot $env:LOTWISE_GUARD_INPUT))", bad);
      assert.equal(result.status, 3, `${path.basename(file)} accepted ${JSON.stringify(bad)}: ${result.stdout}`);
    }
    const drive = runGuard(file, ['Resolve-InstallRoot'], "[Console]::Out.WriteLine((Resolve-InstallRoot $env:LOTWISE_GUARD_INPUT))", 'C:\\');
    assert.ok(drive.stdout.includes('drive root'), drive.stdout);
    const good = runGuard(file, ['Resolve-InstallRoot'], "[Console]::Out.WriteLine((Resolve-InstallRoot $env:LOTWISE_GUARD_INPUT))", `${acceptable}\\`);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.equal(good.stdout.trim(), acceptable);
  }
});

test('Find-Chrome skips an App Paths key that has no default value instead of throwing', win32, () => {
  const key = `${KEY_PARENT}\\find-chrome-${randomBytes(4).toString('hex')}`;
  const found = path.join(tmpdir(), `lotwise-find-chrome-${randomBytes(4).toString('hex')}.exe`);
  try {
    // Only a throwaway key under HKCU:\Software\LotwiseInstallerTest is created, and removed in finally.
    const setup = powershell(['-Command', `New-Item -Path '${key}' -Force | Out-Null; New-ItemProperty -Path '${key}' -Name Path -Value 'C:\\x' -PropertyType String -Force | Out-Null`]);
    assert.equal(setup.status, 0, setup.stderr);
    writeFileSync(found, '');
    const noDefault = runGuard(installScript, ['Find-Chrome'], "Set-StrictMode -Version Latest; [Console]::Out.WriteLine('ok:' + [string](Find-Chrome -Keys $env:LOTWISE_GUARD_INPUT))", key);
    assert.equal(noDefault.status, 0, noDefault.stdout + noDefault.stderr);
    assert.ok(noDefault.stdout.startsWith('ok:'), noDefault.stdout);

    const withDefault = powershell(['-Command', `Set-ItemProperty -LiteralPath '${key}' -Name '(default)' -Value '${found}'`]);
    assert.equal(withDefault.status, 0, withDefault.stderr);
    const result = runGuard(installScript, ['Find-Chrome'], "Set-StrictMode -Version Latest; [Console]::Out.WriteLine('ok:' + [string](Find-Chrome -Keys $env:LOTWISE_GUARD_INPUT))", key);
    assert.equal(result.stdout.trim(), `ok:${found}`, result.stdout + result.stderr);
  } finally {
    rmSync(found, { force: true });
    removeTestKeys(key);
  }
});

// Pulls one top-level function out of a script so two copies can be compared character for character.
function functionText(file, name) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = text.match(new RegExp(`^function ${name}\\b[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(match, `${name} is missing from ${path.basename(file)}`);
  return match[0];
}

function displayNameLine(file) {
  const match = readFileSync(file, 'utf8').match(/^\$LotwiseDisplayName = .*$/m);
  assert.ok(match, `$LotwiseDisplayName is missing from ${path.basename(file)}`);
  return match[0].trim();
}

// A registry key that looks like another program's uninstall entry: a value that is not Lotwise's, and a subkey.
function seedForeignKey(key) {
  const result = powershell(['-Command',
    `New-Item -Path '${key}' -Force | Out-Null; ` +
    `New-ItemProperty -Path '${key}' -Name DisplayName -Value 'Other app' -PropertyType String | Out-Null; ` +
    `New-ItemProperty -Path '${key}' -Name keep -Value 1 -PropertyType String | Out-Null; ` +
    `New-Item -Path '${key}\\sub' | Out-Null`]);
  assert.equal(result.status, 0, result.stderr);
}

function assertForeignKeyIntact(key) {
  assert.equal(regValue(key, 'DisplayName'), 'Other app');
  assert.equal(regValue(key, 'keep'), '1');
  assert.ok(keyExists(`${key}\\sub`));
}

test('the guard code that each script carries alone is textually identical in both', () => {
  for (const name of ['Resolve-InstallRoot', 'Test-LotwiseInstall', 'Assert-UninstallKey', 'Assert-KeyIsFreeOrLotwise']) {
    assert.equal(functionText(installScript, name), functionText(uninstallScript, name), name);
  }
  assert.equal(displayNameLine(installScript), displayNameLine(uninstallScript));
});

test('install refuses a non-empty folder that is not a Lotwise install and leaves it alone', win32, () => {
  withSandbox(({ base, root, key, install }) => {
    writeFile(path.join(root, 'extension', 'mine.txt'), 'mine');
    writeFile(path.join(root, 'extension.old', 'older.txt'), 'older');
    writeFile(path.join(root, 'notes.txt'), 'notes');
    const result = install(makeZip(base, 'pkg1', baseFiles), '1.0.0');

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Lotwise install'), result.stderr);
    assert.equal(readFileSync(path.join(root, 'extension', 'mine.txt'), 'utf8'), 'mine');
    assert.equal(readFileSync(path.join(root, 'extension.old', 'older.txt'), 'utf8'), 'older');
    assert.equal(readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'notes');
    assert.ok(!existsSync(path.join(root, 'uninstall.ps1')));
    assert.ok(!existsSync(path.join(root, 'guide.html')));
    assert.ok(!existsSync(path.join(root, 'extension.new')));
    assert.ok(!keyExists(key));
  });
});

test('install into an existing empty folder works', win32, () => {
  withSandbox(({ base, root, install }) => {
    mkdirSync(root, { recursive: true });
    const result = install(makeZip(base, 'pkg1', baseFiles), '1.0.0');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(root, 'extension', 'manifest.json')));
  });
});

test('both scripts refuse a root that is not a full path, or is a drive or share root, and touch nothing', win32, () => {
  withSandbox(({ base, key }) => {
    const zip = makeZip(base, 'pkg1', baseFiles);
    const local = path.join(base, 'localappdata');
    mkdirSync(local);
    const before = readdirSync(base).sort();
    const options = { cwd: base, env: { ...process.env, LOCALAPPDATA: local } };
    // Drive roots and 'C:' are checked on the guard function alone above: without the guard they would write to the real C: drive.
    for (const root of ['relative-root', '', '\\\\127.0.0.1\\nosuchshare\\']) {
      const label = JSON.stringify(root);
      let result = powershell(['-File', installScript, '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key, '-PackageZip', zip, '-Version', '1.0.0'], options);
      assert.notEqual(result.status, 0, `install accepted ${label}`);
      result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key], options);
      assert.notEqual(result.status, 0, `uninstall accepted ${label}`);
      assert.deepEqual(readdirSync(base).sort(), before, `${label} created or removed something in the working folder`);
      // PowerShell itself creates a Microsoft folder under LOCALAPPDATA, so only Lotwise's own folder counts.
      assert.deepEqual(readdirSync(local).filter((name) => name !== 'Microsoft'), [], `${label} created something in the default location`);
      assert.ok(!keyExists(key), `${label} wrote the registry entry`);
    }
  });
});

test('a filesystem path, another hive or a bad name is refused as the uninstall key by both scripts', win32, () => {
  withSandbox(({ base, root, install }) => {
    const zip = makeZip(base, 'pkg1', baseFiles);
    const victim = path.join(base, 'victim');
    writeFile(path.join(victim, 'keep.txt'), 'keep');
    const badName = `${KEY_PARENT}\\bad name!`;
    // Without the guard, 'HKCU:\LotwiseInstallerTest\x' would be created; it is removed in finally, but only if it did not exist before.
    const strayParent = 'HKCU:\\LotwiseInstallerTest';
    assert.ok(!keyExists(strayParent), `${strayParent} already exists, refusing to run`);
    try {
      for (const bad of [victim, 'HKCU:\\LotwiseInstallerTest\\x', badName]) {
        assert.equal(install(zip, '1.0.0').status, 0);
        const uninstallArgs = ['-File', path.join(root, 'uninstall.ps1'), '-NoLaunch', '-InstallRoot', root, '-UninstallKey', bad];
        assert.notEqual(powershell(uninstallArgs).status, 0, `uninstall accepted ${bad}`);
        assert.ok(existsSync(path.join(root, 'extension', 'manifest.json')), `uninstall removed files for ${bad}`);
        assert.ok(existsSync(path.join(victim, 'keep.txt')));

        const other = path.join(base, 'other root');
        const result = powershell(['-File', installScript, '-NoLaunch', '-InstallRoot', other, '-UninstallKey', bad, '-PackageZip', zip, '-Version', '1.0.0']);
        assert.notEqual(result.status, 0, `install accepted ${bad}`);
        assert.ok(!existsSync(other), `install created a folder for ${bad}`);
        assert.ok(existsSync(path.join(victim, 'keep.txt')));
        assert.ok(!keyExists(badName), 'a key with a bad name was created');
      }
    } finally {
      removeTestKeys(badName);
      powershell(['-Command', `Remove-Item -LiteralPath '${strayParent}' -Recurse -Force -ErrorAction SilentlyContinue`]);
    }
  });
});

// This test never runs a script against a key like HKCU:\Software: Assert-UninstallKey only validates a string.
test('Assert-UninstallKey in both scripts refuses every key outside a plain HKCU:\\Software subpath', win32, () => {
  const defaultKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Lotwise';
  const call = "Assert-UninstallKey $env:LOTWISE_GUARD_INPUT; [Console]::Out.WriteLine('accepted')";
  for (const file of [installScript, uninstallScript]) {
    const names = path.basename(file);
    for (const bad of [
      'HKCU:\\Software', 'HKCU:\\Software\\', 'HKCU:\\', 'HKCU:\\Software\\Microsoft\\..\\..', 'HKCU:\\Software\\..',
      'HKLM:\\Software\\X', 'Registry::HKEY_CURRENT_USER\\Software\\X', '', 'C:\\Windows', 'HKCU:\\Software\\a*b', 'HKCU:\\Software\\a\\',
    ]) {
      const result = runGuard(file, ['Assert-UninstallKey'], call, bad);
      assert.equal(result.status, 3, `${names} accepted ${JSON.stringify(bad)}: ${result.stdout}`);
    }
    for (const good of ['HKCU:\\Software\\LotwiseInstallerTest\\abc123', defaultKey]) {
      const result = runGuard(file, ['Assert-UninstallKey'], call, good);
      assert.equal(result.status, 0, `${names} refused ${good}: ${result.stdout}${result.stderr}`);
    }
  }
});

test('an existing registry key that is not a Lotwise entry is never overwritten or deleted', win32, () => {
  withSandbox(({ base, root, key, install }) => {
    const foreign = `${KEY_PARENT}\\foreign-${randomBytes(4).toString('hex')}`;
    const zip = makeZip(base, 'pkg1', baseFiles);
    try {
      seedForeignKey(foreign);
      const refused = powershell(['-File', installScript, '-NoLaunch', '-InstallRoot', root, '-UninstallKey', foreign, '-PackageZip', zip, '-Version', '1.0.0']);
      assert.notEqual(refused.status, 0);
      assert.ok(refused.stderr.includes('not a Lotwise'), refused.stderr);
      assert.ok(!existsSync(root), 'install created the folder before refusing the key');
      assertForeignKeyIntact(foreign);

      assert.equal(install(zip, '1.0.0').status, 0);
      const removal = powershell(['-File', path.join(root, 'uninstall.ps1'), '-NoLaunch', '-InstallRoot', root, '-UninstallKey', foreign]);
      assert.notEqual(removal.status, 0);
      assert.ok(existsSync(path.join(root, 'extension', 'manifest.json')), 'uninstall removed files before refusing the key');
      assertForeignKeyIntact(foreign);
      assert.ok(keyExists(key));
    } finally {
      removeTestKeys(foreign);
    }
  });
});

test('install then uninstall removes exactly the key install wrote', win32, () => {
  withSandbox(({ base, key, install, uninstall }) => {
    const sibling = `${KEY_PARENT}\\sibling-${randomBytes(4).toString('hex')}`;
    try {
      seedForeignKey(sibling);
      assert.equal(install(makeZip(base, 'pkg1', baseFiles), '1.0.0').status, 0);
      assert.equal(install(makeZip(base, 'pkg2', baseFiles), '1.0.1').status, 0, 'an update over the existing Lotwise key must work');
      assert.equal(regValue(key, 'DisplayVersion'), '1.0.1');
      assert.equal(uninstall().status, 0);
      assert.ok(!keyExists(key));
      assertForeignKeyIntact(sibling);
    } finally {
      removeTestKeys(sibling);
    }
  });
});

test('a failure after the folder swap says the files were updated and names the step', win32, () => {
  withSandbox(({ base, root, install }) => {
    assert.equal(install(makeZip(base, 'first', baseFiles), '1.0.0').status, 0);
    // A folder where guide.html should be stops the guide step only, after the swap has gone through.
    rmSync(path.join(root, 'guide.html'));
    mkdirSync(path.join(root, 'guide.html'));
    const result = install(makeZip(base, 'second', { ...baseFiles, 'only-second.txt': '2' }), '2.0.0');

    assert.equal(result.status, EXIT_SHOWN_FAILURE);
    assert.ok(result.stderr.includes('extension files were updated'), result.stderr);
    assert.ok(result.stderr.includes('guide'), result.stderr);
    assert.ok(!result.stderr.includes('could not be installed'), result.stderr);
    assert.ok(existsSync(path.join(root, 'extension', 'only-second.txt')));
  });
});

test('install writes a Lotwise marker file, keeps it current on update and uninstall removes it', win32, () => {
  withSandbox(({ base, root, install, uninstall }) => {
    const marker = path.join(root, 'lotwise-install.json');
    assert.equal(install(makeZip(base, 'pkg1', baseFiles), '9.8.7').status, 0);
    const bytes = readFileSync(marker);
    assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'the marker has a BOM');
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), { app: 'Lotwise', installer: 1, version: '9.8.7' });

    assert.equal(install(makeZip(base, 'pkg2', baseFiles), '9.8.8').status, 0, 'an update of a real install must work');
    assert.equal(JSON.parse(readFileSync(marker, 'utf8')).version, '9.8.8');

    assert.equal(uninstall().status, 0);
    assert.ok(!existsSync(marker));
  });
});

test('a folder with only uninstall.ps1 and guide.html is refused by both scripts and keeps its files', win32, () => {
  withSandbox(({ base, key }) => {
    const folder = path.join(base, 'installer copy');
    mkdirSync(folder);
    for (const name of ['uninstall.ps1', 'guide.html']) copyFileSync(path.join(installerDir, name), path.join(folder, name));
    const before = Object.fromEntries(readdirSync(folder).map((name) => [name, readFileSync(path.join(folder, name), 'utf8')]));

    let result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', folder, '-UninstallKey', key]);
    assert.notEqual(result.status, 0);
    result = powershell(['-File', installScript, '-NoLaunch', '-InstallRoot', folder, '-UninstallKey', key, '-PackageZip', makeZip(base, 'pkg1', baseFiles), '-Version', '1.0.0']);
    assert.notEqual(result.status, 0);

    const after = Object.fromEntries(readdirSync(folder).map((name) => [name, readFileSync(path.join(folder, name), 'utf8')]));
    assert.deepEqual(after, before);
  });
});

test('a marker whose app is not Lotwise, or that is not JSON, is refused by both scripts', win32, () => {
  withSandbox(({ base, key }) => {
    const zip = makeZip(base, 'pkg1', baseFiles);
    for (const [name, content] of [['other', '{"app":"Other","installer":1}'], ['broken', 'not json'], ['empty', '']]) {
      const folder = path.join(base, name);
      writeFile(path.join(folder, 'uninstall.ps1'), 'x');
      writeFile(path.join(folder, 'lotwise-install.json'), content);
      writeFile(path.join(folder, 'extension', 'manifest.json'), '{}');

      let result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', folder, '-UninstallKey', key]);
      assert.notEqual(result.status, 0, `uninstall accepted the ${name} marker`);
      result = powershell(['-File', installScript, '-NoLaunch', '-InstallRoot', folder, '-UninstallKey', key, '-PackageZip', zip, '-Version', '1.0.0']);
      assert.notEqual(result.status, 0, `install accepted the ${name} marker`);
      assert.equal(readFileSync(path.join(folder, 'uninstall.ps1'), 'utf8'), 'x');
      assert.equal(readFileSync(path.join(folder, 'lotwise-install.json'), 'utf8'), content);
      assert.ok(existsSync(path.join(folder, 'extension', 'manifest.json')));
    }
  });
});

test('a first install that fails after the folder swap cleans up, so running setup again works', win32, () => {
  withSandbox(({ base, root, key }) => {
    const packaged = path.join(base, 'packaged');
    mkdirSync(packaged);
    for (const name of ['install.ps1', 'uninstall.ps1']) copyFileSync(path.join(installerDir, name), path.join(packaged, name));
    writeFileSync(path.join(packaged, 'version.txt'), '4.5.6');
    copyFileSync(makeZip(base, 'fixture', baseFiles), path.join(packaged, 'lotwise-extension.zip'));
    const run = () => powershell(['-File', path.join(packaged, 'install.ps1'), '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key]);

    // No guide.html beside the script, so the guide step fails after the swap and after uninstall.ps1 was copied.
    const failed = run();
    assert.equal(failed.status, EXIT_SHOWN_FAILURE);
    assert.ok(failed.stderr.includes('writing the guide'), failed.stderr);
    assert.deepEqual(existsSync(root) ? readdirSync(root) : [], [], 'the failed first install left files behind');
    assert.ok(!keyExists(key));

    copyFileSync(path.join(installerDir, 'guide.html'), path.join(packaged, 'guide.html'));
    const retry = run();
    assert.equal(retry.status, 0, retry.stderr);
    assert.ok(existsSync(path.join(root, 'extension', 'manifest.json')));
    assert.ok(keyExists(key));
  });
});

test('a missing LOCALAPPDATA gives the normal error and a failing exit code from both scripts, and nothing is written', win32, () => {
  withSandbox(({ base, key }) => {
    const scratch = path.join(base, 'scratch');
    mkdirSync(scratch);
    const dropped = ['LOCALAPPDATA', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP'];
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !dropped.includes(name.toUpperCase())));
    Object.assign(env, { USERPROFILE: scratch, APPDATA: scratch, TEMP: scratch, TMP: scratch });
    const options = { cwd: scratch, env };

    let result = powershell(['-File', installScript, '-NoLaunch', '-UninstallKey', key, '-PackageZip', makeZip(base, 'pkg1', baseFiles), '-Version', '1.0.0'], options);
    assert.equal(result.status, EXIT_SHOWN_FAILURE);
    assert.match(result.stderr, /LOCALAPPDATA is not set/);
    result = powershell(['-File', uninstallScript, '-NoLaunch', '-UninstallKey', key], options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LOCALAPPDATA is not set/);
    assert.ok(!keyExists(key));
  });
});

test('a missing package beside the script gives the normal error and a failing exit code', win32, () => {
  withSandbox(({ base, root, key }) => {
    const packaged = path.join(base, 'packaged');
    mkdirSync(packaged);
    copyFileSync(path.join(installerDir, 'install.ps1'), path.join(packaged, 'install.ps1'));
    writeFileSync(path.join(packaged, 'version.txt'), '1.0.0');
    const result = powershell(['-File', path.join(packaged, 'install.ps1'), '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key]);
    assert.equal(result.status, EXIT_SHOWN_FAILURE);
    assert.ok(result.stderr.includes('package was not found'), result.stderr);
  });
});

test('a leftover extension.old that cannot be removed fails the install and removes extension.new', win32, () => {
  withSandbox(({ base, root, install }) => {
    assert.equal(install(makeZip(base, 'first', { ...baseFiles, 'keep.txt': 'k' }), '1.0.0').status, 0);
    const stuck = path.join(root, 'extension.old', 'lib', 'a.js');
    writeFile(stuck, 'old');
    // A second process holds the file with no sharing, which stops Windows from deleting it (an open handle in this
    // process would not, because Node opens files with delete sharing). The ready file shows the lock is in place.
    const ready = path.join(base, 'lock-ready.txt');
    const holder = spawn('powershell.exe', ['-NoProfile', '-Command',
      `$f = [System.IO.File]::Open('${stuck}', 'Open', 'Read', 'None'); Set-Content -LiteralPath '${ready}' -Value 1; Start-Sleep -Seconds 120`]);
    try {
      assert.ok(waitUntil(() => existsSync(ready), 30), 'the lock holder did not start');
      const result = install(makeZip(base, 'next', { ...baseFiles, 'only-second.txt': '2' }), '2.0.0');
      assert.equal(result.status, EXIT_SHOWN_FAILURE, 'the update should fail while the leftover folder is held open');
      assert.ok(!existsSync(path.join(root, 'extension.new')), 'extension.new was left behind');
      assert.ok(existsSync(path.join(root, 'extension', 'keep.txt')));
      assert.ok(!existsSync(path.join(root, 'extension', 'only-second.txt')));
    } finally {
      // Kills only the holder this test started; taskkill is synchronous, so the lock is gone before cleanup runs.
      spawnSync('taskkill', ['/pid', String(holder.pid), '/f', '/t']);
      waitUntil(() => {
        try { rmSync(stuck, { force: true }); return !existsSync(stuck); } catch { return false; }
      }, 20);
    }
  });
});

test('an install root with square brackets and a space installs, updates and uninstalls in that exact folder', win32, () => {
  withSandbox(({ base, root, key, install, uninstall }) => {
    assert.equal(install(makeZip(base, 'pkg1', { ...baseFiles, 'only-first.txt': '1' }), '1.0.0').status, 0);
    for (const name of ['extension\\manifest.json', 'uninstall.ps1', 'guide.html', 'lotwise-install.json']) {
      assert.ok(existsSync(path.join(root, name)), `${name} is missing from ${root}`);
    }
    assert.equal(install(makeZip(base, 'pkg2', { ...baseFiles, 'only-second.txt': '2' }), '1.0.1').status, 0);
    assert.ok(existsSync(path.join(root, 'extension', 'only-second.txt')));
    assert.ok(!existsSync(path.join(root, 'extension', 'only-first.txt')));
    assert.equal(regValue(key, 'DisplayVersion'), '1.0.1');
    // Nothing may land in a folder the brackets would match as a wildcard.
    assert.deepEqual(readdirSync(base).filter((name) => name.startsWith('lotwise ') && name !== path.basename(root) && !name.endsWith('-src')).sort(), []);

    assert.equal(uninstall().status, 0);
    assert.ok(waitUntil(() => !existsSync(root), 15), 'the install root was not removed');
    assert.ok(!keyExists(key));
  }, 'lotwise [1] test');
});

test('guide.html tells the user about the SmartScreen notice and the developer mode notice', () => {
  const guide = readFileSync(path.join(installerDir, 'guide.html'), 'utf8');
  assert.match(guide, /not code-signed/i);
  assert.ok(guide.includes('Windows protected your PC'));
  assert.ok(guide.includes('More info'));
  assert.ok(guide.includes('Run anyway'));
  assert.match(guide, /release page/i);
  assert.ok(guide.includes('Disable developer mode extensions'));
  assert.ok(!/https?:\/\//i.test(guide));
});

// A zip whose second entry points outside the target folder, so extraction fails after the first file was written.
function makeBadZip(base, name) {
  const zip = path.join(base, `${name}.zip`);
  const script = "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
    `$z = [System.IO.Compression.ZipFile]::Open('${zip}', 'Create'); ` +
    "foreach ($n in 'manifest.json', '../outside.txt') { $e = $z.CreateEntry($n); $w = New-Object System.IO.StreamWriter($e.Open()); $w.Write('x'); $w.Dispose() }; $z.Dispose()";
  const result = powershell(['-Command', script]);
  assert.equal(result.status, 0, result.stderr);
  return zip;
}

test('a package that fails part-way through extraction leaves no extension.new and the old install alone', win32, () => {
  withSandbox(({ base, root, install }) => {
    assert.equal(install(makeZip(base, 'good', { ...baseFiles, 'keep.txt': 'k' }), '1.0.0').status, 0);
    const result = install(makeBadZip(base, 'bad'), '2.0.0');
    assert.equal(result.status, EXIT_SHOWN_FAILURE);
    assert.ok(result.stderr.trim().length > 0);
    assert.ok(!existsSync(path.join(root, 'extension.new')), 'the partial extension.new was left behind');
    assert.ok(existsSync(path.join(root, 'extension', 'keep.txt')));
  });
});

test('a first install with a package that fails part-way leaves the folder empty', win32, () => {
  withSandbox(({ base, root, key, install }) => {
    const result = install(makeBadZip(base, 'bad'), '2.0.0');
    assert.equal(result.status, EXIT_SHOWN_FAILURE);
    assert.deepEqual(existsSync(root) ? readdirSync(root) : [], []);
    assert.ok(!keyExists(key));
  });
});

test('the leftover-folder note and the failed first install messages say what remains', win32, () => {
  const note = runGuard(installScript, ['Get-LeftoverNote'], "[Console]::Out.WriteLine((Get-LeftoverNote 'C:\\x\\extension.old'))", '');
  assert.equal(note.status, 0, note.stderr);
  assert.ok(note.stdout.includes('C:\\x\\extension.old') && /delete/i.test(note.stdout) && /by hand/i.test(note.stdout), note.stdout);

  const clean = runGuard(installScript, ['Get-FirstInstallFailureMessage'],
    "[Console]::Out.WriteLine((Get-FirstInstallFailureMessage ' while writing the guide' 'boom.' @()))", '');
  assert.ok(clean.stdout.includes('Nothing was left behind'), clean.stdout);
  assert.ok(clean.stdout.includes('boom.'));

  const dirty = runGuard(installScript, ['Get-FirstInstallFailureMessage'],
    "[Console]::Out.WriteLine((Get-FirstInstallFailureMessage ' while writing the guide' 'boom.' @('the folder C:\\x', 'the registry key HKCU:\\Software\\y')))", '');
  assert.ok(!dirty.stdout.includes('Nothing was left behind'), dirty.stdout);
  assert.ok(dirty.stdout.includes('C:\\x') && dirty.stdout.includes('HKCU:\\Software\\y') && /by hand/i.test(dirty.stdout), dirty.stdout);
});

// Holds a file open with no sharing from a second process; returns a function that releases it.
function holdFile(base, file) {
  const ready = path.join(base, `lock-ready-${randomBytes(3).toString('hex')}.txt`);
  const holder = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$f = [System.IO.File]::Open('${file}', 'Open', 'Read', 'None'); Set-Content -LiteralPath '${ready}' -Value 1; Start-Sleep -Seconds 120`]);
  assert.ok(waitUntil(() => existsSync(ready), 30), 'the lock holder did not start');
  return () => {
    spawnSync('taskkill', ['/pid', String(holder.pid), '/f', '/t']);
    waitUntil(() => {
      try { rmSync(file, { force: true }); return !existsSync(file); } catch { return false; }
    }, 20);
  };
}

test('uninstall that cannot remove a file tells the user to close Chrome and run it again', win32, () => {
  withSandbox(({ base, root, key, install, uninstall }) => {
    assert.equal(install(makeZip(base, 'pkg1', baseFiles), '1.0.0').status, 0);
    const release = holdFile(base, path.join(root, 'extension', 'lib', 'a.js'));
    try {
      const result = uninstall();
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes('chrome://extensions'), result.stderr);
      assert.match(result.stderr, /run the uninstall again/i);
      // The files go first, then the registry entry, then the marker. After a failed file removal the Installed apps
      // entry and the marker are both still there, so the uninstall can be run again from Settings.
      assert.ok(keyExists(key), 'the registry entry was removed although the files were not');
      assert.ok(existsSync(path.join(root, 'lotwise-install.json')), 'the marker was removed although the files were not');
    } finally {
      release();
    }
    const rerun = uninstall();
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.ok(!existsSync(path.join(root, 'lotwise-install.json')));
    assert.ok(!existsSync(path.join(root, 'extension')));
    assert.ok(!keyExists(key));
  });
});

test('uninstall removes the files, then the registry entry, then the marker, and names a key it cannot remove', win32, () => {
  const text = readFileSync(uninstallScript, 'utf8');
  const tryBlock = text.slice(text.lastIndexOf('\ntry {'));
  const order = ['Remove-InstalledFiles $InstallRoot', 'Remove-UninstallEntry $UninstallKey', 'Remove-InstallMarker $InstallRoot'].map((call) => tryBlock.indexOf(call));
  assert.ok(order.every((index) => index > 0), `a removal step is missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the removal steps run in the wrong order');
  assert.ok(!/foreach \(\$name in [^\r\n]*'lotwise-install\.json'/.test(text), 'the marker must not be in the list removed with the other files');

  // Test-Path and Remove-Item are replaced in the child, so no real key or file is touched.
  const result = runGuard(uninstallScript, ['Remove-UninstallEntry'],
    "function Test-Path { $true }; function Remove-Item { throw 'denied' }; Remove-UninstallEntry 'HKCU:\\Software\\LotwiseInstallerTest\\named-key'", '');
  assert.equal(result.status, 3, result.stdout);
  assert.ok(result.stdout.includes('HKCU:\\Software\\LotwiseInstallerTest\\named-key') && result.stdout.includes('denied'), result.stdout);
});

test('a percent sign in the install folder is refused by install and uninstall with a clear message', win32, () => {
  withSandbox(({ base, key }) => {
    const root = path.join(base, 'lotwise 100% test');
    let result = powershell(['-File', installScript, '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key, '-PackageZip', makeZip(base, 'pkg1', baseFiles), '-Version', '1.0.0']);
    assert.equal(result.status, EXIT_SHOWN_FAILURE);
    assert.ok(result.stderr.includes('percent sign'), result.stderr);
    assert.ok(!existsSync(root));

    // Built by hand, because install would refuse to make one.
    writeFile(path.join(root, 'uninstall.ps1'), 'x');
    writeFile(path.join(root, 'lotwise-install.json'), '{"app":"Lotwise","installer":1,"version":"1"}');
    writeFile(path.join(root, 'extension', 'manifest.json'), '{}');
    result = powershell(['-File', uninstallScript, '-NoLaunch', '-InstallRoot', root, '-UninstallKey', key]);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('percent sign'), result.stderr);
    assert.ok(existsSync(path.join(root, 'extension', 'manifest.json')));
  });
});

test('every exit in install.ps1 is 0 or the named code for a failure it already showed', () => {
  const lines = readFileSync(installScript, 'utf8').split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
  const text = lines.join('\n');
  assert.equal([...text.matchAll(/^\$ExitShownFailure = (\d+)\s*$/gm)].map((m) => Number(m[1])).join(), String(EXIT_SHOWN_FAILURE));
  const exits = [...text.matchAll(/\bexit\s+(\S+)/g)].map((m) => m[1]);
  assert.ok(exits.length >= 3, 'expected the success exit, the catch exit and the trap exit');
  for (const code of exits) assert.ok(code === '0' || code === '$ExitShownFailure', `unexpected exit ${code}`);
});

const launchScript = path.join(installerDir, 'launch.cmd');

// launch.cmd runs install.ps1 beside it. The environment variable makes it print its message to stderr instead of
// opening a message box.
function runLaunchWith(stubExit) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lotwise launch '));
  try {
    copyFileSync(launchScript, path.join(dir, 'launch.cmd'));
    writeFileSync(path.join(dir, 'install.ps1'), `Set-Content -LiteralPath (Join-Path $PSScriptRoot 'ran.txt') -Value 1\nexit ${stubExit}\n`);
    const result = spawnSync('cmd.exe', ['/c', '.\\launch.cmd'], { cwd: dir, encoding: 'utf8', env: { ...process.env, LOTWISE_SETUP_NO_DIALOG: '1' } });
    return { result, ran: existsSync(path.join(dir, 'ran.txt')) };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

const BLOCKED_MESSAGE = "Lotwise Setup could not start. The usual cause is that this PC does not allow PowerShell scripts (a policy set by your organization or Windows settings). Nothing was installed. You can still load Lotwise by hand: see INSTALL in the project's README.";

test('launch.cmd passes the exit code on and shows the blocked message only when install.ps1 gave no message of its own', win32, () => {
  for (const [stubExit, expectMessage] of [[0, false], [EXIT_SHOWN_FAILURE, false], [1, true]]) {
    const { result, ran } = runLaunchWith(stubExit);
    assert.ok(ran, `the stub did not run for exit ${stubExit}`);
    assert.equal(result.status, stubExit, `exit ${stubExit}: ${result.stderr}`);
    assert.equal(result.stderr.includes(BLOCKED_MESSAGE), expectMessage, `exit ${stubExit}: ${result.stderr}`);
    assert.equal(result.stdout.includes('could not start'), false);
  }
});

test('launch.cmd is ASCII with CRLF line ends and the message command never runs the installer', () => {
  const bytes = readFileSync(launchScript);
  assert.ok(bytes.every((byte) => byte < 128), 'launch.cmd has a non-ASCII character');
  const text = bytes.toString('latin1');
  assert.ok(!/[^\r]\n/.test(text), 'launch.cmd has a line end that is not CRLF');
  assert.ok(!/Invoke-Expression|iex |-EncodedCommand/i.test(text));
  const message = text.split('\r\n').filter((line) => /-Command/.test(line));
  assert.equal(message.length, 1);
  assert.ok(!/install\.ps1|-File/.test(message[0]), 'the message command must not touch the installer');
  assert.ok(message[0].includes("see INSTALL in the project''s README."));
});

test('the build script ships launch.cmd and starts the exe through it', () => {
  const build = readFileSync(path.join(repoRoot, 'scripts', 'build-installer.ps1'), 'utf8');
  assert.ok(build.includes("'AppLaunched=\"cmd.exe /c .\\launch.cmd\"'"));
  assert.match(build, /\$files = [^\r\n]*'launch\.cmd'/);
  assert.match(build, /foreach \(\$name in [^\r\n]*'launch\.cmd'/);
});

test('the build script gives both quiet commands the AppLaunched command, so /Q and /Q:A do not run <None>', () => {
  const build = readFileSync(path.join(repoRoot, 'scripts', 'build-installer.ps1'), 'utf8');
  const launch = 'cmd.exe /c .\\launch.cmd';
  assert.ok(build.includes(`'AdminQuietInstCmd="${launch}"'`));
  assert.ok(build.includes(`'UserQuietInstCmd="${launch}"'`));
  assert.ok(!/QuietInstCmd=(""|<None>)?'/.test(build), 'an empty quiet command makes /Q fail with Error creating process <<None>>');
});

// The build script runs top to bottom, so these cases run a copy of it inside a throwaway repo layout.
function withBuildRepo(run) {
  const base = mkdtempSync(path.join(tmpdir(), 'lotwise build '));
  try {
    mkdirSync(path.join(base, 'repo', 'scripts'), { recursive: true });
    mkdirSync(path.join(base, 'repo', 'dist'), { recursive: true });
    writeFile(path.join(base, 'repo', 'tools', 'extension-wasm', 'a.js'), 'a');
    copyFileSync(path.join(repoRoot, 'scripts', 'build-installer.ps1'), path.join(base, 'repo', 'scripts', 'build-installer.ps1'));
    run({ base, repo: path.join(base, 'repo'), script: path.join(base, 'repo', 'scripts', 'build-installer.ps1') });
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

test('the build script reads the version from the zip with its real Get-ZipVersion', win32, () => {
  withBuildRepo(({ base }) => {
    const source = readFileSync(path.join(repoRoot, 'scripts', 'build-installer.ps1'), 'utf8').replace(/\r\n/g, '\n');
    const fn = source.match(/^function Get-ZipVersion[\s\S]*?^\}$/m);
    assert.ok(fn, 'Get-ZipVersion is missing from build-installer.ps1');
    const harness = path.join(base, 'harness.ps1');
    writeFileSync(harness, `${fn[0]}\nGet-ZipVersion $args[0]\n`);

    const good = makeZip(base, 'good', { 'manifest.json': '{"version":"3.2.1"}' });
    let result = powershell(['-File', harness, good]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '3.2.1');

    const nested = makeZip(base, 'nested', { 'sub/manifest.json': '{"version":"3.2.1"}' });
    result = powershell(['-File', harness, nested]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('manifest.json'), result.stderr);
  });
});

test('the build script fails clearly when the package has no version', win32, () => {
  withBuildRepo(({ base, repo, script }) => {
    copyFileSync(makeZip(base, 'store', { 'manifest.json': '{"name":"x"}' }), path.join(repo, 'dist', 'extension-wasm-store.zip'));
    const old = new Date('2030-01-01T00:00:00Z');
    utimesSync(path.join(repo, 'dist', 'extension-wasm-store.zip'), old, old);
    const result = powershell(['-File', script, '-SkipExtensionBuild']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no version/i);
    assert.ok(!existsSync(path.join(repo, 'dist', 'Lotwise-Setup-.exe')));
  });
});

test('-SkipExtensionBuild fails when a source file is newer than the store zip', win32, () => {
  withBuildRepo(({ base, repo, script }) => {
    const zip = path.join(repo, 'dist', 'extension-wasm-store.zip');
    copyFileSync(makeZip(base, 'store', { 'manifest.json': '{"version":"1.2.3"}' }), zip);
    const old = new Date('2020-06-15T12:00:00Z');
    utimesSync(zip, old, old);
    const result = powershell(['-File', script, '-SkipExtensionBuild']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('a.js'), result.stderr);
    assert.match(result.stderr, /newer/i);
    assert.ok(result.stderr.includes('2020'), result.stderr);
  });
});

test('-SkipExtensionBuild also checks the store transform and the extension build script', win32, () => {
  for (const relative of ['scripts\\lib\\store-package.mjs', 'scripts\\build-wasm-extension.ps1']) {
    withBuildRepo(({ base, repo, script }) => {
      const zip = path.join(repo, 'dist', 'extension-wasm-store.zip');
      copyFileSync(makeZip(base, 'store', { 'manifest.json': '{"version":"1.2.3"}' }), zip);
      writeFile(path.join(repo, relative), 'changed');
      const older = new Date('2021-01-01T12:00:00Z');
      utimesSync(path.join(repo, 'tools', 'extension-wasm', 'a.js'), older, older);
      const stamp = new Date('2022-01-01T12:00:00Z');
      utimesSync(zip, stamp, stamp);
      const result = powershell(['-File', script, '-SkipExtensionBuild']);
      assert.notEqual(result.status, 0, `a newer ${relative} was not noticed`);
      assert.ok(result.stderr.includes(path.basename(relative)), result.stderr);
    });
  }
});

const keyFile = path.join(installerDir, 'extension-key.json');

test('the installer extension id is what Chrome derives from the key, and the relay allows it', () => {
  const { key, id } = JSON.parse(readFileSync(keyFile, 'utf8'));
  assert.match(id, /^[a-p]{32}$/);
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  const derived = [...hex].map((digit) => String.fromCharCode('a'.charCodeAt(0) + parseInt(digit, 16))).join('');
  assert.equal(id, derived);

  const wrangler = readFileSync(path.join(repoRoot, 'tools', 'relay', 'wrangler.toml'), 'utf8');
  const allowed = wrangler.match(/^ALLOWED_EXTENSION_IDS = "([^"]*)"/m);
  assert.ok(allowed, 'ALLOWED_EXTENSION_IDS is missing from wrangler.toml');
  assert.ok(allowed[1].split(',').map((item) => item.trim()).includes(id), `${id} is not in ALLOWED_EXTENSION_IDS`);
});

test('the build script fails clearly when the installer key file is missing or malformed, before building anything', win32, () => {
  const bad = [['missing', null], ['not json', 'nope'], ['no key', '{"id":"x"}'], ['short key', '{"key":"abc"}'], ['not base64', `{"key":"${'!'.repeat(120)}"}`]];
  for (const [label, content] of bad) {
    withBuildRepo(({ base, repo, script }) => {
      const zip = path.join(repo, 'dist', 'extension-wasm-store.zip');
      copyFileSync(makeZip(base, 'store', { 'manifest.json': '{"version":"1.2.3"}' }), zip);
      const future = new Date('2030-01-01T00:00:00Z');
      utimesSync(zip, future, future);
      if (content !== null) writeFile(path.join(repo, 'tools', 'installer', 'extension-key.json'), content);
      const result = powershell(['-File', script, '-SkipExtensionBuild']);
      assert.notEqual(result.status, 0, `${label}: the build went on`);
      assert.match(result.stderr, /extension key file/i, `${label}: ${result.stderr}`);
      assert.ok(!existsSync(path.join(repo, 'dist', 'Lotwise-Setup-1.2.3.exe')), label);
    });
  }
});

test('guide.html keeps both placeholders, shows the Extensions address as text and loads nothing remote', () => {
  const guide = readFileSync(path.join(installerDir, 'guide.html'), 'utf8');
  assert.ok(guide.includes('{{EXTENSION_PATH}}'));
  assert.ok(guide.includes('{{VERSION}}'));
  assert.ok(!/https?:\/\//i.test(guide));
  assert.ok(guide.includes('chrome://extensions'));
  assert.ok(!/href\s*=\s*["']?\s*chrome:/i.test(guide));
});

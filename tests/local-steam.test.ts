import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findSteamPath,
  formatBytes,
  getInstalledGames,
  launchSteamGame,
  openSteamView,
  parseRegistryDwordValue,
  parseRegistryStringValue,
  validateSteamUri,
} from '../src/local-steam.js';

describe('local-steam helpers and filesystem scanning', () => {
  const originalSteamPath = process.env.STEAM_PATH;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (originalSteamPath === undefined) {
      delete process.env.STEAM_PATH;
    } else {
      process.env.STEAM_PATH = originalSteamPath;
    }

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('respects STEAM_PATH when configured and throws when missing', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-steam-test-'));
    tempDirs.push(tempRoot);

    process.env.STEAM_PATH = tempRoot;
    expect(await findSteamPath()).toBe(path.resolve(tempRoot));

    process.env.STEAM_PATH = path.join(tempRoot, 'does-not-exist');
    await expect(findSteamPath()).rejects.toThrow(/STEAM_PATH/);
  });

  it('discovers games across multiple library folders from libraryfolders.vdf', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-steam-libs-'));
    tempDirs.push(tempRoot);

    const primarySteam = path.join(tempRoot, 'SteamPrimary');
    const secondaryLib = path.join(tempRoot, 'SteamSecondary');
    await fs.mkdir(path.join(primarySteam, 'steamapps'), { recursive: true });
    await fs.mkdir(path.join(secondaryLib, 'steamapps'), { recursive: true });

    const escapedPrimary = primarySteam.replace(/\\/g, '\\\\');
    const escapedSecondary = secondaryLib.replace(/\\/g, '\\\\');

    await fs.writeFile(
      path.join(primarySteam, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"
{
  "0"
  {
    "path" "${escapedPrimary}"
  }
  "1"
  {
    "path" "${escapedSecondary}"
  }
}
`,
      'utf8',
    );

    await fs.writeFile(
      path.join(primarySteam, 'steamapps', 'appmanifest_620.acf'),
      `"AppState"
{
  "appid" "620"
  "name" "Portal 2"
  "StateFlags" "4"
  "installdir" "Portal 2"
  "LastUpdated" "1700000000"
  "SizeOnDisk" "11811160064"
}
`,
      'utf8',
    );

    await fs.writeFile(
      path.join(secondaryLib, 'steamapps', 'appmanifest_400.acf'),
      `"AppState"
{
  "appid" "400"
  "name" "Portal"
  "StateFlags" "2"
  "installdir" "Portal"
  "LastUpdated" "0"
  "SizeOnDisk" "5368709120"
}
`,
      'utf8',
    );

    process.env.STEAM_PATH = primarySteam;
    const games = await getInstalledGames();

    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      appId: 400,
      name: 'Portal',
      installDir: 'Portal',
      libraryPath: path.resolve(secondaryLib),
      sizeOnDiskBytes: 5368709120,
      sizeFormatted: '5.00 GB',
      stateFlags: 2,
      isFullyInstalled: false,
      lastUpdated: null,
    });
    expect(games[1]).toMatchObject({
      appId: 620,
      name: 'Portal 2',
      installDir: 'Portal 2',
      libraryPath: path.resolve(primarySteam),
      sizeOnDiskBytes: 11811160064,
      sizeFormatted: '11.00 GB',
      stateFlags: 4,
      isFullyInstalled: true,
    });
    expect(games[1]?.lastUpdated).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('parses Windows registry REG_SZ and REG_DWORD hex outputs', () => {
    const steamPathOutput = `
HKEY_CURRENT_USER\\Software\\Valve\\Steam
    SteamPath    REG_SZ    c:/program files (x86)/steam
`;
    expect(parseRegistryStringValue(steamPathOutput, 'SteamPath')).toBe('c:/program files (x86)/steam');

    const runningZero = `
HKEY_CURRENT_USER\\Software\\Valve\\Steam
    RunningAppID    REG_DWORD    0x0
`;
    expect(parseRegistryDwordValue(runningZero, 'RunningAppID')).toBe(0);

    const runningGame = `
HKEY_CURRENT_USER\\Software\\Valve\\Steam
    RunningAppID    REG_DWORD    0x1095dc
`;
    expect(parseRegistryDwordValue(runningGame, 'RunningAppID')).toBe(1086940);
  });

  it('validates appId, view, and Steam URIs strictly', async () => {
    expect(validateSteamUri('steam://rungameid/620')).toBe('steam://rungameid/620');
    expect(() => validateSteamUri('steam://rungameid/620 & calc.exe')).toThrow();
    expect(() => validateSteamUri('https://example.com')).toThrow();

    await expect(launchSteamGame(0)).rejects.toThrow();
    await expect(launchSteamGame(-10)).rejects.toThrow();
    await expect(launchSteamGame(12.5)).rejects.toThrow();
    await expect(openSteamView('invalid' as never)).rejects.toThrow();
  });

  it('formats byte sizes cleanly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
  });
});

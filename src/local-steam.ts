import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { parseVdf } from './vdf-parser.js';

const execFileAsync = promisify(execFile);

const STEAM_REGISTRY_KEY = 'HKCU\\Software\\Valve\\Steam';
const STEAM_URI_REGEX = /^steam:\/\/[a-zA-Z0-9_/]+$/;
const APPMANIFEST_REGEX = /^appmanifest_(\d+)\.acf$/i;
const STATE_FULLY_INSTALLED_BIT = 4;

export const AppIdSchema = z.number().int().positive();
export const SteamViewSchema = z.enum(['bigpicture', 'downloads', 'games', 'friends']);

export type SteamView = z.infer<typeof SteamViewSchema>;

const STEAM_VIEW_URIS: Record<SteamView, string> = {
  bigpicture: 'steam://open/bigpicture',
  downloads: 'steam://open/downloads',
  games: 'steam://nav/games',
  friends: 'steam://open/friends',
};

export interface InstalledSteamGame {
  appId: number;
  name: string;
  installDir: string;
  installPath: string | null;
  libraryPath: string;
  sizeOnDiskBytes: number;
  sizeFormatted: string;
  stateFlags: number;
  isFullyInstalled: boolean;
  lastUpdated: string | null;
}

export interface RunningSteamGame {
  isRunning: boolean;
  appId: number | null;
  name: string | null;
  game: InstalledSteamGame | null;
}

export interface LaunchSteamGameResult {
  launched: boolean;
  appId: number;
  uri: string;
}

export interface OpenSteamViewResult {
  opened: boolean;
  view: SteamView;
  uri: string;
}

export interface ShutdownSteamClientResult {
  shutdownRequested: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return unitIndex === 0 ? `${Math.round(value)} B` : `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function parseRegistryStringValue(output: string, valueName: string): string | null {
  const pattern = new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+)$`, 'im');
  const match = output.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

export function parseRegistryDwordValue(output: string, valueName: string): number | null {
  const pattern = new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_DWORD\\s+(0x[0-9a-f]+|\\d+)`, 'im');
  const match = output.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  const raw = match[1].trim();
  const parsed = raw.toLowerCase().startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function querySteamRegistryOutput(valueName: string): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', STEAM_REGISTRY_KEY, '/v', valueName], {
      windowsHide: true,
      timeout: 5000,
    });
    return stdout;
  } catch {
    return null;
  }
}

function getWindowsFallbackPaths(): string[] {
  const candidates = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  const envX86 = process.env['ProgramFiles(x86)'];
  const envPrograms = process.env.ProgramFiles;
  if (envX86) {
    candidates.push(path.join(envX86, 'Steam'));
  }
  if (envPrograms) {
    candidates.push(path.join(envPrograms, 'Steam'));
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(resolved);
    }
  }
  return unique;
}

function getPosixFallbackPaths(): string[] {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Steam')];
  }
  return [path.join(home, '.steam', 'steam'), path.join(home, '.local', 'share', 'Steam')];
}

/**
 * Automatically detects the local Steam installation path.
 * Prioritizes process.env.STEAM_PATH, then Windows Registry HKCU\Software\Valve\Steam, then default paths.
 */
export async function findSteamPath(): Promise<string> {
  const envPath = process.env.STEAM_PATH?.trim();
  if (envPath) {
    const resolvedEnvPath = path.resolve(envPath);
    if (await directoryExists(resolvedEnvPath)) {
      return resolvedEnvPath;
    }
    throw new Error(`Configured STEAM_PATH directory does not exist: ${resolvedEnvPath}`);
  }

  if (process.platform === 'win32') {
    const regOutput = await querySteamRegistryOutput('SteamPath');
    if (regOutput) {
      const regSteamPath = parseRegistryStringValue(regOutput, 'SteamPath');
      if (regSteamPath) {
        const resolvedRegPath = path.resolve(regSteamPath);
        if (await directoryExists(resolvedRegPath)) {
          return resolvedRegPath;
        }
      }
    }

    for (const candidate of getWindowsFallbackPaths()) {
      if (await directoryExists(candidate)) {
        return candidate;
      }
    }
  } else {
    for (const candidate of getPosixFallbackPaths()) {
      if (await directoryExists(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    'Steam installation directory could not be detected. Set the STEAM_PATH environment variable to your Steam folder.',
  );
}

async function discoverLibraryPaths(steamPath: string): Promise<string[]> {
  const libraryPaths: string[] = [];
  const seen = new Set<string>();

  const addLibraryPath = (candidate: string): void => {
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      libraryPaths.push(resolved);
    }
  };

  addLibraryPath(steamPath);

  const libraryFoldersFile = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (await fileExists(libraryFoldersFile)) {
    const raw = await fs.readFile(libraryFoldersFile, 'utf8');
    const parsed = parseVdf(raw);
    const foldersNode = parsed.libraryfolders ?? parsed.LibraryFolders;

    if (isPlainRecord(foldersNode)) {
      for (const [key, value] of Object.entries(foldersNode)) {
        if (isPlainRecord(value) && typeof value.path === 'string' && value.path.trim().length > 0) {
          addLibraryPath(value.path.trim());
        } else if (/^\d+$/.test(key) && typeof value === 'string' && value.trim().length > 0) {
          addLibraryPath(value.trim());
        }
      }
    }
  }

  return libraryPaths;
}

function parseManifestGame(
  rawContent: string,
  fallbackAppId: number,
  libraryPath: string,
): InstalledSteamGame | null {
  const parsed = parseVdf(rawContent);
  const appState = parsed.AppState ?? parsed.appstate;
  if (!isPlainRecord(appState)) {
    return null;
  }

  const rawAppId = typeof appState.appid === 'string' ? Number.parseInt(appState.appid, 10) : fallbackAppId;
  const appIdResult = AppIdSchema.safeParse(rawAppId);
  if (!appIdResult.success) {
    return null;
  }

  const appId = appIdResult.data;
  const name =
    typeof appState.name === 'string' && appState.name.trim().length > 0 ? appState.name.trim() : `App ${appId}`;
  const installDir = typeof appState.installdir === 'string' ? appState.installdir.trim() : '';
  const installPath = installDir ? path.join(libraryPath, 'steamapps', 'common', installDir) : null;

  const rawSize = typeof appState.SizeOnDisk === 'string' ? Number.parseInt(appState.SizeOnDisk, 10) : 0;
  const sizeOnDiskBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 0;

  const rawFlags = typeof appState.StateFlags === 'string' ? Number.parseInt(appState.StateFlags, 10) : 0;
  const stateFlags = Number.isFinite(rawFlags) && rawFlags >= 0 ? rawFlags : 0;
  const isFullyInstalled = (stateFlags & STATE_FULLY_INSTALLED_BIT) === STATE_FULLY_INSTALLED_BIT;

  const rawLastUpdated = typeof appState.LastUpdated === 'string' ? Number.parseInt(appState.LastUpdated, 10) : 0;
  const lastUpdated =
    Number.isFinite(rawLastUpdated) && rawLastUpdated > 0
      ? new Date(rawLastUpdated * 1000).toISOString()
      : null;

  return {
    appId,
    name,
    installDir,
    installPath,
    libraryPath,
    sizeOnDiskBytes,
    sizeFormatted: formatBytes(sizeOnDiskBytes),
    stateFlags,
    isFullyInstalled,
    lastUpdated,
  };
}

/**
 * Scans all Steam library folders configured in libraryfolders.vdf and reads appmanifest_*.acf files.
 */
export async function getInstalledGames(): Promise<InstalledSteamGame[]> {
  const steamPath = await findSteamPath();
  const libraryPaths = await discoverLibraryPaths(steamPath);
  const gamesById = new Map<number, InstalledSteamGame>();

  for (const libraryPath of libraryPaths) {
    const steamAppsDir = path.join(libraryPath, 'steamapps');
    if (!(await directoryExists(steamAppsDir))) {
      continue;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(steamAppsDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const match = entry.match(APPMANIFEST_REGEX);
      if (!match?.[1]) {
        continue;
      }

      const fallbackAppId = Number.parseInt(match[1], 10);
      const manifestPath = path.join(steamAppsDir, entry);

      try {
        const content = await fs.readFile(manifestPath, 'utf8');
        const game = parseManifestGame(content, fallbackAppId, libraryPath);
        if (!game) {
          continue;
        }

        const existing = gamesById.get(game.appId);
        if (!existing || (!existing.isFullyInstalled && game.isFullyInstalled)) {
          gamesById.set(game.appId, game);
        }
      } catch {
        // Skip unreadable or temporarily locked manifest files
      }
    }
  }

  return Array.from(gamesById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
}

/**
 * Queries Windows Registry RunningAppID and cross-references it against installed Steam games.
 */
export async function getRunningSteamGame(): Promise<RunningSteamGame> {
  if (process.platform !== 'win32') {
    return { isRunning: false, appId: null, name: null, game: null };
  }

  const regOutput = await querySteamRegistryOutput('RunningAppID');
  if (!regOutput) {
    return { isRunning: false, appId: null, name: null, game: null };
  }

  const runningAppId = parseRegistryDwordValue(regOutput, 'RunningAppID');
  if (!runningAppId || runningAppId <= 0) {
    return { isRunning: false, appId: null, name: null, game: null };
  }

  let matchedGame: InstalledSteamGame | null = null;
  try {
    const installedGames = await getInstalledGames();
    matchedGame = installedGames.find((game) => game.appId === runningAppId) ?? null;
  } catch {
    matchedGame = null;
  }

  return {
    isRunning: true,
    appId: runningAppId,
    name: matchedGame?.name ?? null,
    game: matchedGame,
  };
}

export function validateSteamUri(uri: string): string {
  if (!STEAM_URI_REGEX.test(uri)) {
    throw new Error(`Invalid Steam URI rejected: ${uri}`);
  }
  return uri;
}

async function openSteamUri(uri: string): Promise<void> {
  const safeUri = validateSteamUri(uri);

  if (process.platform === 'win32') {
    await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', safeUri], {
      windowsHide: true,
      timeout: 10_000,
    });
    return;
  }

  if (process.platform === 'darwin') {
    await execFileAsync('open', [safeUri], { timeout: 10_000 });
    return;
  }

  if (process.platform === 'linux') {
    await execFileAsync('xdg-open', [safeUri], { timeout: 10_000 });
    return;
  }

  throw new Error(`Unsupported platform for Steam URI launch: ${process.platform}`);
}

/**
 * Launches a Steam game by validated positive integer App ID via steam://rungameid/<appId>.
 */
export async function launchSteamGame(appId: number): Promise<LaunchSteamGameResult> {
  const validatedAppId = AppIdSchema.parse(appId);
  const uri = validateSteamUri(`steam://rungameid/${validatedAppId}`);
  await openSteamUri(uri);
  return {
    launched: true,
    appId: validatedAppId,
    uri,
  };
}

/**
 * Opens a specific Steam client view (bigpicture, downloads, games, or friends).
 */
export async function openSteamView(view: SteamView): Promise<OpenSteamViewResult> {
  const validatedView = SteamViewSchema.parse(view);
  const uri = validateSteamUri(STEAM_VIEW_URIS[validatedView]);
  await openSteamUri(uri);
  return {
    opened: true,
    view: validatedView,
    uri,
  };
}

/**
 * Requests graceful shutdown of the local Steam client using `steam.exe -shutdown`.
 */
export async function shutdownSteamClient(): Promise<ShutdownSteamClientResult> {
  if (process.platform === 'win32') {
    const steamPath = await findSteamPath();
    const steamExePath = path.join(steamPath, 'steam.exe');
    if (!(await fileExists(steamExePath))) {
      throw new Error(`Steam executable not found at: ${steamExePath}`);
    }
    await execFileAsync(steamExePath, ['-shutdown'], {
      windowsHide: true,
      timeout: 10_000,
    });
    return { shutdownRequested: true };
  }

  if (process.platform === 'linux' || process.platform === 'darwin') {
    await execFileAsync('steam', ['-shutdown'], { timeout: 10_000 });
    return { shutdownRequested: true };
  }

  throw new Error(`Unsupported platform for Steam shutdown: ${process.platform}`);
}

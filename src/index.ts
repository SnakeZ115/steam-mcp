#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  AppIdSchema,
  SteamViewSchema,
  findSteamPath,
  getInstalledGames,
  getRunningSteamGame,
  launchSteamGame,
  openSteamView,
  type InstalledSteamGame,
} from './local-steam.js';
import {
  SteamIdSchema,
  StoreSearchQuerySchema,
  getFriendsActivity,
  getOwnedGamesStats,
  getPlayerAchievements,
  searchStoreGames,
} from './steam-api.js';

function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

function formatCaughtError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveGameByName(
  games: InstalledSteamGame[],
  gameName: string,
): { match?: InstalledSteamGame; error?: string } {
  const needle = gameName.trim().toLowerCase();
  const exactMatches = games.filter((game) => game.name.trim().toLowerCase() === needle);

  if (exactMatches.length === 1) {
    return { match: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    const candidates = exactMatches.map((g) => `${g.name} (appId: ${g.appId})`).join(', ');
    return { error: `Multiple installed games exactly match "${gameName}": ${candidates}. Specify appId directly.` };
  }

  const partialMatches = games.filter((game) => game.name.toLowerCase().includes(needle));
  if (partialMatches.length === 0) {
    return {
      error: `No installed Steam game matching "${gameName}" was found. Use list_installed_games to check installed titles.`,
    };
  }
  if (partialMatches.length > 1) {
    const preview = partialMatches
      .slice(0, 10)
      .map((g) => `${g.name} (appId: ${g.appId})`)
      .join(', ');
    const suffix = partialMatches.length > 10 ? ` (and ${partialMatches.length - 10} more)` : '';
    return {
      error: `Multiple installed games match "${gameName}": ${preview}${suffix}. Specify the exact name or appId.`,
    };
  }

  return { match: partialMatches[0] };
}

export function createSteamMcpServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-steam',
    version: '0.1.0',
  });

  server.registerTool(
    'list_installed_games',
    {
      description: 'List all Steam games installed locally across all configured Steam library folders (no API key required).',
      inputSchema: {
        search: z
          .string()
          .trim()
          .optional()
          .describe('Optional case-insensitive substring filter on installed game names'),
        onlyFullyInstalled: z
          .boolean()
          .optional()
          .describe('When true, include only games whose StateFlags indicate full installation'),
      },
    },
    async ({ search, onlyFullyInstalled }) => {
      try {
        const steamPath = await findSteamPath();
        const allGames = await getInstalledGames();

        let filtered = allGames;
        if (onlyFullyInstalled) {
          filtered = filtered.filter((game) => game.isFullyInstalled);
        }
        if (search) {
          const needle = search.toLowerCase();
          filtered = filtered.filter((game) => game.name.toLowerCase().includes(needle));
        }

        return jsonResult({
          steamPath,
          totalInstalled: allGames.length,
          count: filtered.length,
          games: filtered,
        });
      } catch (error) {
        return errorResult(`Failed to list installed Steam games: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'get_running_game',
    {
      description: 'Check which Steam game is currently running locally (Windows RunningAppID cross-referenced with installed games; no API key required).',
    },
    async () => {
      try {
        const result = await getRunningSteamGame();
        return jsonResult(result);
      } catch (error) {
        return errorResult(`Failed to inspect running Steam game: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'launch_game',
    {
      description: 'Launch a Steam game locally by numeric appId or by searching installed games by name.',
      inputSchema: {
        appId: AppIdSchema.optional().describe('Steam numeric App ID of the game to launch'),
        gameName: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe('Name (or partial name) of an installed Steam game to look up and launch'),
      },
    },
    async ({ appId, gameName }) => {
      try {
        if (appId === undefined && !gameName) {
          return errorResult('Provide either appId or gameName to launch a Steam game.');
        }

        if (appId !== undefined) {
          const launchResult = await launchSteamGame(appId);
          let gameTitle: string | null = null;
          try {
            const installed = await getInstalledGames();
            gameTitle = installed.find((g) => g.appId === appId)?.name ?? null;
          } catch {
            gameTitle = null;
          }
          return jsonResult({
            ...launchResult,
            name: gameTitle,
          });
        }

        const installedGames = await getInstalledGames();
        const resolution = resolveGameByName(installedGames, gameName!);
        if (!resolution.match) {
          return errorResult(resolution.error ?? `Unable to resolve game "${gameName}".`);
        }

        const launchResult = await launchSteamGame(resolution.match.appId);
        return jsonResult({
          ...launchResult,
          name: resolution.match.name,
        });
      } catch (error) {
        return errorResult(`Failed to launch Steam game: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'open_steam_view',
    {
      description: 'Open a specific view in the local Steam client (bigpicture, downloads, games, or friends).',
      inputSchema: {
        view: SteamViewSchema.describe('Steam client view to open: bigpicture, downloads, games, or friends'),
      },
    },
    async ({ view }) => {
      try {
        const result = await openSteamView(view);
        return jsonResult(result);
      } catch (error) {
        return errorResult(`Failed to open Steam view: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'search_store_game',
    {
      description: 'Search the public Steam Store catalog by game title for app ID, price, platforms, and metascore (no API key required).',
      inputSchema: {
        query: StoreSearchQuerySchema.describe('Game title or search keywords'),
      },
    },
    async ({ query }) => {
      try {
        const result = await searchStoreGames(query);
        return jsonResult(result);
      } catch (error) {
        return errorResult(`Failed to search Steam Store: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'get_owned_games_stats',
    {
      description: 'Get top owned Steam games by total and recent playtime hours via the Steam Web API (optional; requires STEAM_API_KEY and STEAM_USER_ID).',
      inputSchema: {
        steamId: SteamIdSchema.optional().describe('Optional 17-digit 64-bit Steam ID override (defaults to STEAM_USER_ID env var)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of top played games to return (1-100, default 20)'),
      },
    },
    async ({ steamId, limit }) => {
      try {
        const result = await getOwnedGamesStats({ steamId, limit });
        return jsonResult(result);
      } catch (error) {
        return errorResult(`Failed to retrieve owned games stats: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'get_friends_activity',
    {
      description: 'List online Steam friends and the games they are currently playing via the Steam Web API (optional; requires STEAM_API_KEY and STEAM_USER_ID).',
      inputSchema: {
        steamId: SteamIdSchema.optional().describe('Optional 17-digit 64-bit Steam ID override (defaults to STEAM_USER_ID env var)'),
      },
    },
    async ({ steamId }) => {
      try {
        const result = await getFriendsActivity({ steamId });
        return jsonResult(result);
      } catch (error) {
        return errorResult(`Failed to retrieve friends activity: ${formatCaughtError(error)}`);
      }
    },
  );

  server.registerTool(
    'get_player_achievements',
    {
      description: 'Get player achievements and completion rate for a specific Steam App ID via the Steam Web API (optional; requires STEAM_API_KEY and STEAM_USER_ID).',
      inputSchema: {
        appId: AppIdSchema.describe('Steam numeric App ID of the game'),
        steamId: SteamIdSchema.optional().describe('Optional 17-digit 64-bit Steam ID override (defaults to STEAM_USER_ID env var)'),
      },
    },
    async ({ appId, steamId }) => {
      try {
        const result = await getPlayerAchievements(appId, { steamId });
        return jsonResult(result);
      } catch (error) {
        return errorResult(`Failed to retrieve player achievements: ${formatCaughtError(error)}`);
      }
    },
  );

  return server;
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    const entryReal = fs.realpathSync(entry);
    const moduleReal = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32'
      ? entryReal.toLowerCase() === moduleReal.toLowerCase()
      : entryReal === moduleReal;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const server = createSteamMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isExecutedDirectly()) {
  main().catch((error) => {
    console.error('Fatal error starting mcp-steam server:', error);
    process.exit(1);
  });
}

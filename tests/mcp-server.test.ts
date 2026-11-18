import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createSteamMcpServer } from '../src/index.js';

describe('MCP Steam server tool registration and execution', () => {
  const originalSteamPath = process.env.STEAM_PATH;
  const originalApiKey = process.env.STEAM_API_KEY;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (originalSteamPath === undefined) {
      delete process.env.STEAM_PATH;
    } else {
      process.env.STEAM_PATH = originalSteamPath;
    }

    if (originalApiKey === undefined) {
      delete process.env.STEAM_API_KEY;
    } else {
      process.env.STEAM_API_KEY = originalApiKey;
    }

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('registers all 8 required tools and handles local & optional API calls cleanly', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-steam-srv-'));
    tempDirs.push(tempRoot);
    await fs.mkdir(path.join(tempRoot, 'steamapps'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n  "0"\n  {\n    "path" "${tempRoot.replace(/\\/g, '\\\\')}"\n  }\n}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(tempRoot, 'steamapps', 'appmanifest_620.acf'),
      `"AppState"\n{\n  "appid" "620"\n  "name" "Portal 2"\n  "StateFlags" "4"\n  "installdir" "Portal 2"\n  "SizeOnDisk" "1073741824"\n}\n`,
      'utf8',
    );

    process.env.STEAM_PATH = tempRoot;
    delete process.env.STEAM_API_KEY;

    const server = createSteamMcpServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const toolsResult = await client.listTools();
      const toolNames = toolsResult.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        'get_friends_activity',
        'get_owned_games_stats',
        'get_player_achievements',
        'get_running_game',
        'launch_game',
        'list_installed_games',
        'open_steam_view',
        'search_store_game',
      ]);

      const installedRes = await client.callTool({ name: 'list_installed_games', arguments: {} });
      expect(installedRes.isError).toBeFalsy();
      const installedText = (installedRes.content[0] as { type: 'text'; text: string }).text;
      const installedJson = JSON.parse(installedText);
      expect(installedJson.count).toBe(1);
      expect(installedJson.games[0].name).toBe('Portal 2');

      const ownedRes = await client.callTool({ name: 'get_owned_games_stats', arguments: {} });
      expect(ownedRes.isError).toBeFalsy();
      const ownedText = (ownedRes.content[0] as { type: 'text'; text: string }).text;
      expect(ownedText).toContain('steamcommunity.com/dev/apikey');

      const missingLaunchArg = await client.callTool({ name: 'launch_game', arguments: {} });
      expect(missingLaunchArg.isError).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

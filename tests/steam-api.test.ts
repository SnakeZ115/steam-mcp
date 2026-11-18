import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getFriendsActivity,
  getOwnedGamesStats,
  getPlayerAchievements,
  searchStoreGames,
} from '../src/steam-api.js';

describe('steam-api module', () => {
  const originalApiKey = process.env.STEAM_API_KEY;
  const originalUserId = process.env.STEAM_USER_ID;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalApiKey === undefined) {
      delete process.env.STEAM_API_KEY;
    } else {
      process.env.STEAM_API_KEY = originalApiKey;
    }
    if (originalUserId === undefined) {
      delete process.env.STEAM_USER_ID;
    } else {
      process.env.STEAM_USER_ID = originalUserId;
    }
  });

  it('returns clear non-throwing instructions when STEAM_API_KEY is missing', async () => {
    delete process.env.STEAM_API_KEY;
    delete process.env.STEAM_USER_ID;

    const owned = await getOwnedGamesStats();
    expect(owned.available).toBe(false);
    if (!owned.available) {
      expect(owned.reason).toBe('missing_api_key');
      expect(owned.message).toContain('steamcommunity.com/dev/apikey');
    }

    const friends = await getFriendsActivity();
    expect(friends.available).toBe(false);
    if (!friends.available) {
      expect(friends.reason).toBe('missing_api_key');
      expect(friends.message).toContain('steamcommunity.com/dev/apikey');
    }

    const achievements = await getPlayerAchievements(620);
    expect(achievements.available).toBe(false);
    if (!achievements.available) {
      expect(achievements.reason).toBe('missing_api_key');
      expect(achievements.message).toContain('steamcommunity.com/dev/apikey');
    }
  });

  it('parses Steam Store search response without an API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          items: [
            {
              id: 620,
              name: 'Portal 2',
              type: 'app',
              price: { currency: 'USD', initial: 999, final: 199 },
              metascore: '95',
              platforms: { windows: true, mac: false, linux: true },
              controller_support: 'full',
              tiny_image: 'https://example.com/capsule.jpg',
            },
          ],
        }),
      })),
    );

    const result = await searchStoreGames('Portal 2');
    expect(result.query).toBe('Portal 2');
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      appId: 620,
      name: 'Portal 2',
      type: 'app',
      price: {
        currency: 'USD',
        initialCents: 999,
        finalCents: 199,
        discountPercent: 80,
        formattedFinal: 'USD 1.99',
      },
      metascore: 95,
      platforms: { windows: true, mac: false, linux: true },
      controllerSupport: 'full',
      tinyImage: 'https://example.com/capsule.jpg',
      storeUrl: 'https://store.steampowered.com/app/620/',
    });
  });

  it('sorts owned games by playtime and converts minutes to hours', async () => {
    process.env.STEAM_API_KEY = 'dummy-test-key';
    process.env.STEAM_USER_ID = '76561198000000000';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            game_count: 2,
            games: [
              { appid: 400, name: 'Portal', playtime_forever: 120, playtime_2weeks: 0 },
              { appid: 620, name: 'Portal 2', playtime_forever: 900, playtime_2weeks: 90 },
            ],
          },
        }),
      })),
    );

    const stats = await getOwnedGamesStats({ limit: 5 });
    expect(stats.available).toBe(true);
    if (stats.available) {
      expect(stats.totalOwnedGames).toBe(2);
      expect(stats.topGames[0]).toMatchObject({
        appId: 620,
        name: 'Portal 2',
        playtimeForeverHours: 15,
        playtime2WeeksHours: 1.5,
      });
    }
  });

  it('lists online and in-game friends with in-game friends prioritized', async () => {
    process.env.STEAM_API_KEY = 'dummy-test-key';
    process.env.STEAM_USER_ID = '76561198000000000';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          friendslist: {
            friends: [
              { steamid: '76561198000000001' },
              { steamid: '76561198000000002' },
              { steamid: '76561198000000003' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            players: [
              { steamid: '76561198000000001', personaname: 'OfflineBob', personastate: 0 },
              { steamid: '76561198000000002', personaname: 'Alice', personastate: 1 },
              {
                steamid: '76561198000000003',
                personaname: 'Zed',
                personastate: 1,
                gameextrainfo: "Baldur's Gate 3",
                gameid: '1086940',
              },
            ],
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const activity = await getFriendsActivity();
    expect(activity.available).toBe(true);
    if (activity.available) {
      expect(activity.totalFriends).toBe(3);
      expect(activity.onlineCount).toBe(2);
      expect(activity.inGameCount).toBe(1);
      expect(activity.onlineFriends[0]).toMatchObject({
        personaName: 'Zed',
        inGame: true,
        currentGame: "Baldur's Gate 3",
        currentGameId: 1086940,
      });
      expect(activity.onlineFriends[1]).toMatchObject({
        personaName: 'Alice',
        inGame: false,
        currentGame: null,
      });
    }
  });

  it('fetches player achievements and computes completion percent', async () => {
    process.env.STEAM_API_KEY = 'dummy-test-key';
    process.env.STEAM_USER_ID = '76561198000000000';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          playerstats: {
            steamID: '76561198000000000',
            gameName: 'Portal 2',
            success: true,
            achievements: [
              { apiname: 'ACH_1', achieved: 1, unlocktime: 1700000000, name: 'Wake Up Call' },
              { apiname: 'ACH_2', achieved: 0, unlocktime: 0, name: 'You Monster' },
            ],
          },
        }),
      })),
    );

    const res = await getPlayerAchievements(620);
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.totalAchievements).toBe(2);
      expect(res.unlockedCount).toBe(1);
      expect(res.completionPercent).toBe(50);
    }
  });
});

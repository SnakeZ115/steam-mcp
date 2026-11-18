import { z } from 'zod';

const STORE_SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const STEAM_API_BASE_URL = 'https://api.steampowered.com';
const REQUEST_TIMEOUT_MS = 10_000;
const PLAYER_SUMMARIES_BATCH_SIZE = 100;

export const StoreSearchQuerySchema = z.string().trim().min(1, 'Search query must not be empty').max(200);
export const SteamIdSchema = z.string().trim().regex(/^\d{17}$/, 'Steam ID must be a 17-digit 64-bit Steam ID');
export const WebApiAppIdSchema = z.number().int().positive();

const StoreSearchResponseSchema = z.object({
  total: z.number().optional().default(0),
  items: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        name: z.string(),
        type: z.string().optional().default('app'),
        price: z
          .object({
            currency: z.string(),
            initial: z.number(),
            final: z.number(),
          })
          .optional(),
        metascore: z.union([z.string(), z.number()]).optional(),
        platforms: z
          .object({
            windows: z.boolean().optional().default(false),
            mac: z.boolean().optional().default(false),
            linux: z.boolean().optional().default(false),
          })
          .optional(),
        controller_support: z.string().optional(),
        tiny_image: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

const OwnedGamesResponseSchema = z.object({
  response: z
    .object({
      game_count: z.number().optional(),
      games: z
        .array(
          z.object({
            appid: z.number().int().positive(),
            name: z.string().optional(),
            playtime_forever: z.number().nonnegative().optional().default(0),
            playtime_2weeks: z.number().nonnegative().optional().default(0),
            rtime_last_played: z.number().nonnegative().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const FriendListResponseSchema = z.object({
  friendslist: z
    .object({
      friends: z
        .array(
          z.object({
            steamid: z.string(),
            relationship: z.string().optional(),
            friend_since: z.number().optional(),
          }),
        )
        .optional()
        .default([]),
    })
    .optional(),
});

const PlayerSummariesResponseSchema = z.object({
  response: z
    .object({
      players: z
        .array(
          z.object({
            steamid: z.string(),
            personaname: z.string().optional(),
            personastate: z.number().int().optional().default(0),
            gameextrainfo: z.string().optional(),
            gameid: z.string().optional(),
            profileurl: z.string().optional(),
          }),
        )
        .optional()
        .default([]),
    })
    .optional(),
});

const PlayerAchievementsResponseSchema = z.object({
  playerstats: z
    .object({
      steamID: z.string().optional(),
      gameName: z.string().optional(),
      success: z.boolean().optional().default(false),
      error: z.string().optional(),
      achievements: z
        .array(
          z.object({
            apiname: z.string(),
            achieved: z.number().int().optional().default(0),
            unlocktime: z.number().nonnegative().optional().default(0),
            name: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional()
        .default([]),
    })
    .optional(),
});

const PERSONA_STATE_LABELS: Record<number, string> = {
  0: 'Offline',
  1: 'Online',
  2: 'Busy',
  3: 'Away',
  4: 'Snooze',
  5: 'Looking to trade',
  6: 'Looking to play',
};

export interface StoreSearchGame {
  appId: number;
  name: string;
  type: string;
  price: {
    currency: string;
    initialCents: number;
    finalCents: number;
    discountPercent: number;
    formattedFinal: string;
  } | null;
  metascore: number | null;
  platforms: {
    windows: boolean;
    mac: boolean;
    linux: boolean;
  };
  controllerSupport: string | null;
  tinyImage: string | null;
  storeUrl: string;
}

export interface StoreSearchResult {
  query: string;
  total: number;
  items: StoreSearchGame[];
}

export interface ApiUnavailableResult {
  available: false;
  reason: 'missing_api_key' | 'missing_user_id' | 'invalid_user_id' | 'api_error';
  message: string;
}

export interface OwnedGameStats {
  appId: number;
  name: string;
  playtimeForeverMinutes: number;
  playtimeForeverHours: number;
  playtime2WeeksMinutes: number;
  playtime2WeeksHours: number;
  lastPlayed: string | null;
}

export interface OwnedGamesStatsResult {
  available: true;
  steamId: string;
  totalOwnedGames: number;
  returnedCount: number;
  topGames: OwnedGameStats[];
}

export interface FriendActivityEntry {
  steamId: string;
  personaName: string;
  personaState: string;
  inGame: boolean;
  currentGame: string | null;
  currentGameId: number | null;
  profileUrl: string | null;
}

export interface FriendsActivityResult {
  available: true;
  steamId: string;
  totalFriends: number;
  onlineCount: number;
  inGameCount: number;
  onlineFriends: FriendActivityEntry[];
}

export interface PlayerAchievementEntry {
  apiName: string;
  name: string;
  description: string | null;
  achieved: boolean;
  unlockTime: string | null;
}

export interface PlayerAchievementsResult {
  available: true;
  steamId: string;
  appId: number;
  gameName: string | null;
  totalAchievements: number;
  unlockedCount: number;
  completionPercent: number;
  achievements: PlayerAchievementEntry[];
}

type CredentialsCheck =
  | { ok: true; apiKey: string; steamId: string }
  | { ok: false; error: ApiUnavailableResult };

function resolveWebApiCredentials(steamIdOverride?: string): CredentialsCheck {
  const apiKey = process.env.STEAM_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: {
        available: false,
        reason: 'missing_api_key',
        message:
          'STEAM_API_KEY is not configured. You can obtain a Steam Web API key at https://steamcommunity.com/dev/apikey and set the STEAM_API_KEY environment variable (together with STEAM_USER_ID).',
      },
    };
  }

  const rawSteamId = (steamIdOverride ?? process.env.STEAM_USER_ID)?.trim();
  if (!rawSteamId) {
    return {
      ok: false,
      error: {
        available: false,
        reason: 'missing_user_id',
        message:
          'STEAM_USER_ID is not configured. Set the STEAM_USER_ID environment variable to your 17-digit 64-bit Steam ID, or provide steamId explicitly.',
      },
    };
  }

  const parsedSteamId = SteamIdSchema.safeParse(rawSteamId);
  if (!parsedSteamId.success) {
    return {
      ok: false,
      error: {
        available: false,
        reason: 'invalid_user_id',
        message: 'Invalid Steam ID format. Expected a 17-digit 64-bit Steam ID.',
      },
    };
  }

  return { ok: true, apiKey, steamId: parsedSteamId.data };
}

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

function formatCents(cents: number, currency: string): string {
  if (cents === 0) {
    return 'Free';
  }
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

async function fetchJson(
  url: string,
  endpointLabel: string,
): Promise<{ status: number; ok: boolean; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.name : 'NetworkError';
    throw new Error(`Failed to reach ${endpointLabel} (${detail})`);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { status: response.status, ok: response.ok, data };
}

function buildSteamApiUrl(endpointPath: string, params: Record<string, string>): string {
  const url = new URL(`${STEAM_API_BASE_URL}/${endpointPath}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Searches the public Steam Store catalog by game title (no API key required).
 */
export async function searchStoreGames(query: string): Promise<StoreSearchResult> {
  const validatedQuery = StoreSearchQuerySchema.parse(query);
  const url = `${STORE_SEARCH_URL}?term=${encodeURIComponent(validatedQuery)}&l=english&cc=US`;

  const res = await fetchJson(url, 'Steam Store Search API');
  if (!res.ok) {
    throw new Error(`Steam Store Search API returned HTTP ${res.status}`);
  }

  const parsed = StoreSearchResponseSchema.parse(res.data);

  const items: StoreSearchGame[] = parsed.items.map((item) => {
    let price: StoreSearchGame['price'] = null;
    if (item.price) {
      const discountPercent =
        item.price.initial > 0 && item.price.final < item.price.initial
          ? Math.round(((item.price.initial - item.price.final) / item.price.initial) * 100)
          : 0;
      price = {
        currency: item.price.currency,
        initialCents: item.price.initial,
        finalCents: item.price.final,
        discountPercent,
        formattedFinal: formatCents(item.price.final, item.price.currency),
      };
    }

    let metascore: number | null = null;
    if (item.metascore !== undefined && item.metascore !== '') {
      const numeric = typeof item.metascore === 'number' ? item.metascore : Number.parseInt(item.metascore, 10);
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) {
        metascore = numeric;
      }
    }

    return {
      appId: item.id,
      name: item.name,
      type: item.type,
      price,
      metascore,
      platforms: {
        windows: item.platforms?.windows ?? false,
        mac: item.platforms?.mac ?? false,
        linux: item.platforms?.linux ?? false,
      },
      controllerSupport: item.controller_support ?? null,
      tinyImage: item.tiny_image ?? null,
      storeUrl: `https://store.steampowered.com/app/${item.id}/`,
    };
  });

  return {
    query: validatedQuery,
    total: parsed.total,
    items,
  };
}

/**
 * Returns top owned Steam games ranked by total and recent playtime hours.
 * Gracefully returns a descriptive message when STEAM_API_KEY or STEAM_USER_ID is missing.
 */
export async function getOwnedGamesStats(options?: {
  steamId?: string;
  limit?: number;
}): Promise<OwnedGamesStatsResult | ApiUnavailableResult> {
  const creds = resolveWebApiCredentials(options?.steamId);
  if (!creds.ok) {
    return creds.error;
  }

  const limit = z.number().int().min(1).max(100).default(20).parse(options?.limit);

  const url = buildSteamApiUrl('IPlayerService/GetOwnedGames/v1/', {
    key: creds.apiKey,
    steamid: creds.steamId,
    include_appinfo: '1',
    include_played_free_games: '1',
    format: 'json',
  });

  let res: { status: number; ok: boolean; data: unknown };
  try {
    res = await fetchJson(url, 'Steam Web API GetOwnedGames');
  } catch (error) {
    return {
      available: false,
      reason: 'api_error',
      message: error instanceof Error ? error.message : 'Failed to call Steam Web API GetOwnedGames.',
    };
  }

  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' Verify that STEAM_API_KEY is valid and the profile Game Details privacy is set to Public.'
        : '';
    return {
      available: false,
      reason: 'api_error',
      message: `Steam Web API GetOwnedGames returned HTTP ${res.status}.${hint}`,
    };
  }

  const parsed = OwnedGamesResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    return {
      available: false,
      reason: 'api_error',
      message: 'Unexpected response format from Steam Web API GetOwnedGames.',
    };
  }

  const rawGames = parsed.data.response?.games ?? [];
  const totalOwnedGames = parsed.data.response?.game_count ?? rawGames.length;

  const sorted = [...rawGames].sort((a, b) => {
    if (b.playtime_forever !== a.playtime_forever) {
      return b.playtime_forever - a.playtime_forever;
    }
    return b.playtime_2weeks - a.playtime_2weeks;
  });

  const topGames: OwnedGameStats[] = sorted.slice(0, limit).map((game) => ({
    appId: game.appid,
    name: game.name?.trim() || `App ${game.appid}`,
    playtimeForeverMinutes: game.playtime_forever,
    playtimeForeverHours: minutesToHours(game.playtime_forever),
    playtime2WeeksMinutes: game.playtime_2weeks,
    playtime2WeeksHours: minutesToHours(game.playtime_2weeks),
    lastPlayed:
      game.rtime_last_played && game.rtime_last_played > 0
        ? new Date(game.rtime_last_played * 1000).toISOString()
        : null,
  }));

  return {
    available: true,
    steamId: creds.steamId,
    totalOwnedGames,
    returnedCount: topGames.length,
    topGames,
  };
}

/**
 * Lists online Steam friends and the game each friend is currently playing.
 * Gracefully returns a descriptive message when STEAM_API_KEY or STEAM_USER_ID is missing.
 */
export async function getFriendsActivity(options?: {
  steamId?: string;
}): Promise<FriendsActivityResult | ApiUnavailableResult> {
  const creds = resolveWebApiCredentials(options?.steamId);
  if (!creds.ok) {
    return creds.error;
  }

  const friendListUrl = buildSteamApiUrl('ISteamUser/GetFriendList/v1/', {
    key: creds.apiKey,
    steamid: creds.steamId,
    relationship: 'friend',
    format: 'json',
  });

  let friendListRes: { status: number; ok: boolean; data: unknown };
  try {
    friendListRes = await fetchJson(friendListUrl, 'Steam Web API GetFriendList');
  } catch (error) {
    return {
      available: false,
      reason: 'api_error',
      message: error instanceof Error ? error.message : 'Failed to call Steam Web API GetFriendList.',
    };
  }

  if (!friendListRes.ok) {
    const hint =
      friendListRes.status === 401 || friendListRes.status === 403
        ? ' Verify that STEAM_API_KEY is valid and the profile Friends List privacy is set to Public.'
        : '';
    return {
      available: false,
      reason: 'api_error',
      message: `Steam Web API GetFriendList returned HTTP ${friendListRes.status}.${hint}`,
    };
  }

  const parsedFriends = FriendListResponseSchema.safeParse(friendListRes.data);
  if (!parsedFriends.success) {
    return {
      available: false,
      reason: 'api_error',
      message: 'Unexpected response format from Steam Web API GetFriendList.',
    };
  }

  const friendIds = parsedFriends.data.friendslist?.friends.map((friend) => friend.steamid) ?? [];
  if (friendIds.length === 0) {
    return {
      available: true,
      steamId: creds.steamId,
      totalFriends: 0,
      onlineCount: 0,
      inGameCount: 0,
      onlineFriends: [],
    };
  }

  const summaries: Array<{
    steamid: string;
    personaname?: string;
    personastate: number;
    gameextrainfo?: string;
    gameid?: string;
    profileurl?: string;
  }> = [];

  for (let offset = 0; offset < friendIds.length; offset += PLAYER_SUMMARIES_BATCH_SIZE) {
    const batch = friendIds.slice(offset, offset + PLAYER_SUMMARIES_BATCH_SIZE);
    const summariesUrl = buildSteamApiUrl('ISteamUser/GetPlayerSummaries/v2/', {
      key: creds.apiKey,
      steamids: batch.join(','),
      format: 'json',
    });

    let summariesRes: { status: number; ok: boolean; data: unknown };
    try {
      summariesRes = await fetchJson(summariesUrl, 'Steam Web API GetPlayerSummaries');
    } catch (error) {
      return {
        available: false,
        reason: 'api_error',
        message: error instanceof Error ? error.message : 'Failed to call Steam Web API GetPlayerSummaries.',
      };
    }

    if (!summariesRes.ok) {
      return {
        available: false,
        reason: 'api_error',
        message: `Steam Web API GetPlayerSummaries returned HTTP ${summariesRes.status}.`,
      };
    }

    const parsedSummaries = PlayerSummariesResponseSchema.safeParse(summariesRes.data);
    if (!parsedSummaries.success) {
      return {
        available: false,
        reason: 'api_error',
        message: 'Unexpected response format from Steam Web API GetPlayerSummaries.',
      };
    }

    summaries.push(...(parsedSummaries.data.response?.players ?? []));
  }

  const onlineFriends: FriendActivityEntry[] = summaries
    .filter((player) => player.personastate > 0 || Boolean(player.gameextrainfo))
    .map((player) => {
      const parsedGameId = player.gameid ? Number.parseInt(player.gameid, 10) : Number.NaN;
      const currentGameId = Number.isInteger(parsedGameId) && parsedGameId > 0 ? parsedGameId : null;
      const currentGame = player.gameextrainfo?.trim() || null;

      return {
        steamId: player.steamid,
        personaName: player.personaname?.trim() || player.steamid,
        personaState: PERSONA_STATE_LABELS[player.personastate] ?? `State ${player.personastate}`,
        inGame: Boolean(currentGame),
        currentGame,
        currentGameId,
        profileUrl: player.profileurl ?? null,
      };
    })
    .sort((a, b) => {
      if (a.inGame !== b.inGame) {
        return a.inGame ? -1 : 1;
      }
      return a.personaName.localeCompare(b.personaName, 'en', { sensitivity: 'base' });
    });

  const inGameCount = onlineFriends.filter((friend) => friend.inGame).length;

  return {
    available: true,
    steamId: creds.steamId,
    totalFriends: friendIds.length,
    onlineCount: onlineFriends.length,
    inGameCount,
    onlineFriends,
  };
}

/**
 * Retrieves player achievements for a given Steam App ID.
 * Gracefully returns a descriptive message when STEAM_API_KEY or STEAM_USER_ID is missing.
 */
export async function getPlayerAchievements(
  appId: number,
  options?: { steamId?: string },
): Promise<PlayerAchievementsResult | ApiUnavailableResult> {
  const validatedAppId = WebApiAppIdSchema.parse(appId);
  const creds = resolveWebApiCredentials(options?.steamId);
  if (!creds.ok) {
    return creds.error;
  }

  const url = buildSteamApiUrl('ISteamUserStats/GetPlayerAchievements/v1/', {
    key: creds.apiKey,
    steamid: creds.steamId,
    appid: String(validatedAppId),
    l: 'english',
    format: 'json',
  });

  let res: { status: number; ok: boolean; data: unknown };
  try {
    res = await fetchJson(url, 'Steam Web API GetPlayerAchievements');
  } catch (error) {
    return {
      available: false,
      reason: 'api_error',
      message: error instanceof Error ? error.message : 'Failed to call Steam Web API GetPlayerAchievements.',
    };
  }

  const parsed = PlayerAchievementsResponseSchema.safeParse(res.data);
  if (parsed.success && parsed.data.playerstats) {
    const stats = parsed.data.playerstats;
    if (!stats.success) {
      return {
        available: false,
        reason: 'api_error',
        message: stats.error ?? `Steam Web API returned an unsuccessful achievements response (HTTP ${res.status}).`,
      };
    }

    const achievements: PlayerAchievementEntry[] = stats.achievements.map((item) => ({
      apiName: item.apiname,
      name: item.name?.trim() || item.apiname,
      description: item.description?.trim() || null,
      achieved: item.achieved === 1,
      unlockTime: item.unlocktime > 0 ? new Date(item.unlocktime * 1000).toISOString() : null,
    }));

    const totalAchievements = achievements.length;
    const unlockedCount = achievements.filter((item) => item.achieved).length;
    const completionPercent =
      totalAchievements > 0 ? Math.round((unlockedCount / totalAchievements) * 1000) / 10 : 0;

    return {
      available: true,
      steamId: stats.steamID ?? creds.steamId,
      appId: validatedAppId,
      gameName: stats.gameName?.trim() || null,
      totalAchievements,
      unlockedCount,
      completionPercent,
      achievements,
    };
  }

  if (!res.ok) {
    return {
      available: false,
      reason: 'api_error',
      message: `Steam Web API GetPlayerAchievements returned HTTP ${res.status}.`,
    };
  }

  return {
    available: false,
    reason: 'api_error',
    message: 'Unexpected response format from Steam Web API GetPlayerAchievements.',
  };
}

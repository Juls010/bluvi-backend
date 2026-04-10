import { createClient, RedisClientType } from 'redis';
import { Redis as UpstashRedis } from '@upstash/redis';

let redisClient: RedisClientType | null = null;
let upstashClient: UpstashRedis | null = null;
let cacheReady = false;
let cacheInitAttempted = false;
let cacheMode: 'none' | 'redis' | 'upstash' = 'none';

const toInt = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const cacheConfig = {
    url: process.env.REDIS_URL || '',
    restUrl: process.env.REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL || '',
    restToken: process.env.REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
    defaultTtlSeconds: toInt(process.env.REDIS_DEFAULT_TTL_SECONDS, 60),
    registerMetadataTtlSeconds: toInt(process.env.CACHE_REGISTER_METADATA_TTL_SECONDS, 3600),
    exploreTtlSeconds: toInt(process.env.CACHE_EXPLORE_TTL_SECONDS, 30),
};

export const isCacheEnabled = () => Boolean(cacheConfig.url || (cacheConfig.restUrl && cacheConfig.restToken));

export const initCache = async () => {
    if (!isCacheEnabled()) {
        return;
    }

    if (cacheReady || cacheInitAttempted) {
        return;
    }

    cacheInitAttempted = true;

    try {
        if (cacheConfig.url) {
            redisClient = createClient({
                url: cacheConfig.url,
                socket: {
                    connectTimeout: 5000,
                    reconnectStrategy: () => false,
                },
            });
            redisClient.on('error', (error) => {
                console.error('[cache] Redis error:', error);
            });

            await redisClient.connect();
            cacheMode = 'redis';
        } else {
            upstashClient = new UpstashRedis({
                url: cacheConfig.restUrl,
                token: cacheConfig.restToken,
            });

            await upstashClient.ping();
            cacheMode = 'upstash';
        }

        cacheReady = true;
        console.log(`[cache] Redis connected (${cacheMode})`);
    } catch (error) {
        cacheReady = false;
        if (redisClient) {
            redisClient.removeAllListeners();
            try {
                redisClient.disconnect();
            } catch {
                // ignore
            }
        }
        redisClient = null;
        upstashClient = null;
        cacheMode = 'none';
        console.error('[cache] Redis init failed, continuing without cache:', error);
    }
};

export const closeCache = async () => {
    if (!cacheReady) {
        return;
    }

    try {
        if (cacheMode === 'redis' && redisClient) {
            try {
                await redisClient.quit();
            } catch {
                await redisClient.disconnect();
            }
        }
    } finally {
        cacheReady = false;
        redisClient = null;
        upstashClient = null;
        cacheInitAttempted = false;
        cacheMode = 'none';
    }
};

export const cacheGetJson = async <T>(key: string): Promise<T | null> => {
    if (!cacheReady) {
        return null;
    }

    try {
        let payload: string | null = null;

        if (cacheMode === 'redis' && redisClient) {
            payload = await redisClient.get(key);
        } else if (cacheMode === 'upstash' && upstashClient) {
            const result = await upstashClient.get<string>(key);
            payload = typeof result === 'string' ? result : null;
        }

        if (!payload) {
            return null;
        }

        return JSON.parse(payload) as T;
    } catch (error) {
        console.error('[cache] cacheGetJson failed:', error);
        return null;
    }
};

export const cacheSetJson = async (key: string, value: unknown, ttlSeconds = cacheConfig.defaultTtlSeconds) => {
    if (!cacheReady) {
        return;
    }

    try {
        const payload = JSON.stringify(value);

        if (cacheMode === 'redis' && redisClient) {
            await redisClient.set(key, payload, { EX: ttlSeconds });
            return;
        }

        if (cacheMode === 'upstash' && upstashClient) {
            await upstashClient.set(key, payload, { ex: ttlSeconds });
        }
    } catch (error) {
        console.error('[cache] cacheSetJson failed:', error);
    }
};

export const cacheDeleteByPrefix = async (prefix: string) => {
    if (!cacheReady) {
        return;
    }

    try {
        if (cacheMode === 'redis' && redisClient) {
            const batch: string[] = [];
            for await (const key of redisClient.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
                batch.push(String(key));
                if (batch.length >= 200) {
                    await redisClient.del(batch);
                    batch.length = 0;
                }
            }

            if (batch.length > 0) {
                await redisClient.del(batch);
            }

            return;
        }

        if (cacheMode === 'upstash' && upstashClient) {
            let cursor = '0';

            do {
                const [nextCursor, keys] = await upstashClient.scan(cursor, {
                    match: `${prefix}*`,
                    count: 200,
                });

                cursor = String(nextCursor);

                if (Array.isArray(keys) && keys.length > 0) {
                    await upstashClient.del(...keys.map((k) => String(k)));
                }
            } while (cursor !== '0');
        }
    } catch (error) {
        console.error('[cache] cacheDeleteByPrefix failed:', error);
    }
};

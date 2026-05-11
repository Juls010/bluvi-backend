import { pool } from '../config/db';

const envInt = (value: string | undefined, fallback: number, min = 1) => {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed < min) {
        return fallback;
    }
    return parsed;
};

const cleanupConfig = {
    maxAgeMinutes: envInt(process.env.UNVERIFIED_USER_TTL_MINUTES, 15),
    intervalMs: envInt(process.env.UNVERIFIED_USER_CLEANUP_INTERVAL_MS, 5 * 60 * 1000),
    batchSize: envInt(process.env.UNVERIFIED_USER_CLEANUP_BATCH_SIZE, 100),
};

export const cleanupExpiredUnverifiedUsers = async () => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const expiredUsers = await client.query<{ id_user: number }>(
            `
                SELECT id_user
                FROM users
                WHERE is_verified = false
                  AND created_at < NOW() - ($1::int * INTERVAL '1 minute')
                ORDER BY created_at ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            `,
            [cleanupConfig.maxAgeMinutes, cleanupConfig.batchSize]
        );

        const userIds = expiredUsers.rows.map((row) => row.id_user);

        if (userIds.length === 0) {
            await client.query('COMMIT');
            return 0;
        }

        await client.query('DELETE FROM user_communication_style WHERE id_user = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM user_preference WHERE id_user = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM user_interest WHERE id_user = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM user_feature WHERE id_user = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM photo WHERE id_user = ANY($1::int[])', [userIds]);
        await client.query('DELETE FROM users WHERE id_user = ANY($1::int[]) AND is_verified = false', [userIds]);

        await client.query('COMMIT');

        console.log(`[registration-cleanup] Removed ${userIds.length} unverified user(s).`);
        return userIds.length;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[registration-cleanup] Failed to remove expired unverified users:', error);
        return 0;
    } finally {
        client.release();
    }
};

export const startRegistrationCleanup = () => {
    cleanupExpiredUnverifiedUsers().catch((error) => {
        console.error('[registration-cleanup] Initial run failed:', error);
    });

    const timer = setInterval(() => {
        cleanupExpiredUnverifiedUsers().catch((error) => {
            console.error('[registration-cleanup] Scheduled run failed:', error);
        });
    }, cleanupConfig.intervalMs);

    timer.unref();

    console.log(
        `[registration-cleanup] Enabled. TTL=${cleanupConfig.maxAgeMinutes}min interval=${cleanupConfig.intervalMs}ms`
    );

    return timer;
};

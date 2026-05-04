import { pool } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { cacheConfig, cacheDeleteByPrefix, cacheGetJson, cacheSetJson } from '../services/cache';
import { handleUserVisibilityChange } from '../services/socket';

let matchTableReadyPromise: Promise<void> | null = null;
let discoverySeenTableReadyPromise: Promise<void> | null = null;
let accessibilityPrefsReadyPromise: Promise<void> | null = null;
let privacyColumnsReadyPromise: Promise<void> | null = null;

const buildExploreCacheKey = (userId: number, query: Record<string, unknown>) => {
    const normalizedEntries = Object.entries(query)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, String(value ?? '')]);

    return `explore:user:${userId}:${JSON.stringify(normalizedEntries)}`;
};

const invalidateUserExploreCache = async (userId: number) => {
    await cacheDeleteByPrefix(`explore:user:${userId}:`);
};

const dataUriOrHttpUrl = /^(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+|https?:\/\/\S+)$/;

const intArraySchema = z.array(z.coerce.number().int().positive()).max(80);

const updateProfileSchema = z.object({
    first_name: z.string().trim().min(1).max(80).optional(),
    last_name: z.string().trim().min(1).max(80).optional(),
    birth_date: z.string().trim().min(1).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    city_lat: z.coerce.number().nullable().optional(),
    city_lng: z.coerce.number().nullable().optional(),
    description: z.string().trim().min(1).max(1200).optional(),
    id_gender: z.coerce.number().int().positive().optional(),
    sexuality: intArraySchema.optional(),
    interests: intArraySchema.optional(),
    neurodivergences: intArraySchema.optional(),
    communication_style: intArraySchema.optional(),
    photos: z.array(z.string().trim().min(1).max(2_000_000).regex(dataUriOrHttpUrl, 'Formato de foto invalido')).max(8).optional(),
});

const deleteAccountSchema = z.object({
    password: z.string().min(8).max(200),
});

const updatePrivacySchema = z
    .object({
        is_visible: z.boolean().optional(),
        messages_only_matches: z.boolean().optional(),
        show_online_status: z.boolean().optional(),
    })
    .refine((body) => body.is_visible !== undefined || body.messages_only_matches !== undefined || body.show_online_status !== undefined, {
        message: 'Debes enviar al menos un campo para actualizar',
    });

const updateAccessibilitySchema = z
    .object({
        contrast: z.enum(['normal', 'high']).optional(),
        reduce_motion: z.boolean().optional(),
        font_size: z.enum(['normal', 'large', 'xlarge']).optional(),
    })
    .refine((body) => body.contrast !== undefined || body.reduce_motion !== undefined || body.font_size !== undefined, {
        message: 'Debes enviar al menos un campo para actualizar',
    });

const markSeenSchema = z.object({
    seenUserId: z.coerce.number().int().positive(),
    action: z.enum(['passed', 'liked', 'dismissed']).optional().default('passed'),
});

const ensureMatchTable = async () => {
    if (!matchTableReadyPromise) {
        matchTableReadyPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS match (
                    id_match SERIAL PRIMARY KEY,
                    id_user INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    id_matched INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    message TEXT,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ,
                    CONSTRAINT uniq_match_pair UNIQUE (id_user, id_matched),
                    CONSTRAINT no_self_match CHECK (id_user <> id_matched)
                )
            `);
        })();
    }

    await matchTableReadyPromise;
};

const ensureDiscoverySeenTable = async () => {
    if (!discoverySeenTableReadyPromise) {
        discoverySeenTableReadyPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_discovery_seen (
                    id_seen SERIAL PRIMARY KEY,
                    id_user INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    seen_user_id INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    action VARCHAR(20) NOT NULL DEFAULT 'passed' CHECK (action IN ('passed', 'liked', 'dismissed')),
                    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT uniq_discovery_seen_pair UNIQUE (id_user, seen_user_id),
                    CONSTRAINT no_self_seen CHECK (id_user <> seen_user_id)
                )
            `);

            await pool.query('CREATE INDEX IF NOT EXISTS idx_discovery_seen_user ON user_discovery_seen (id_user, seen_at DESC)');
        })();
    }

    await discoverySeenTableReadyPromise;
};

const ensurePrivacyColumns = async () => {
    if (!privacyColumnsReadyPromise) {
        privacyColumnsReadyPromise = (async () => {
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS show_online_status BOOLEAN NOT NULL DEFAULT true
            `);
        })();
    }

    await privacyColumnsReadyPromise;
};

// ─── Query reutilizable ───────────────────────────────────────────────────────

const PROFILE_QUERY = `
    SELECT 
        u.id_user, u.email, u.first_name, u.last_name, u.birth_date, u.city, u.description, u.id_gender, u.avatar_url,
        
        COALESCE(
            (SELECT json_agg(up.id_preference::integer) FROM user_preference up WHERE up.id_user = u.id_user),
            CASE
                WHEN u.id_preference IS NULL THEN '[]'::json
                ELSE json_build_array(u.id_preference::integer)
            END
        ) AS sexuality,
        COALESCE(
            (SELECT json_agg(p.name) FROM user_preference up JOIN preference p ON up.id_preference = p.id_preference WHERE up.id_user = u.id_user),
            CASE
                WHEN u.id_preference IS NULL THEN '[]'::json
                ELSE (
                    SELECT json_agg(p2.name)
                    FROM preference p2
                    WHERE p2.id_preference = u.id_preference::integer
                )
            END,
            '[]'::json
        ) AS sexuality_names,

        COALESCE((SELECT json_agg(url_photo ORDER BY is_primary DESC) FROM photo WHERE id_user = u.id_user), '[]') AS photos,

        COALESCE((SELECT json_agg(ui.id_interest) FROM user_interest ui WHERE ui.id_user = u.id_user), '[]') AS id_interests,
        COALESCE((SELECT json_agg(i.name) FROM user_interest ui JOIN interest i ON ui.id_interest = i.id_interest WHERE ui.id_user = u.id_user), '[]') AS interest_names,

        COALESCE((SELECT json_agg(uf.id_feature) FROM user_feature uf WHERE uf.id_user = u.id_user), '[]') AS id_neurodivergences,
        COALESCE((SELECT json_agg(f.name) FROM user_feature uf JOIN feature f ON uf.id_feature = f.id_feature WHERE uf.id_user = u.id_user), '[]') AS neurodivergence_names,

        COALESCE((SELECT json_agg(ucs.id_communication) FROM user_communication_style ucs WHERE ucs.id_user = u.id_user), '[]') AS id_communication_style,
        COALESCE((SELECT json_agg(cs.name) FROM user_communication_style ucs JOIN communication_style cs ON ucs.id_communication = cs.id_communication WHERE ucs.id_user = u.id_user), '[]') AS communication_names

    FROM users u
    WHERE u.id_user = $1
`;

export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const result = await pool.query(PROFILE_QUERY, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        res.status(200).json({ success: true, user: result.rows[0] });

    } catch (error) {
        console.error("Error al obtener perfil:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};


export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const {
            first_name,
            last_name,
            birth_date,
            city,
            description,
            id_gender,
            sexuality,           
            photos,              
            interests,           
            neurodivergences,    
            communication_style, 
        } = (() => {
            const parsed = updateProfileSchema.safeParse(req.body);
            if (!parsed.success) {
                throw new Error(parsed.error.issues[0]?.message || 'Payload invalido');
            }
            return parsed.data;
        })();

        await pool.query(
            `UPDATE users
            SET
                first_name  = COALESCE($1, first_name),
                last_name   = COALESCE($2, last_name),
                birth_date  = COALESCE($3, birth_date),
                city        = COALESCE($4, city),
                description = COALESCE($5, description),
                id_gender   = COALESCE($6, id_gender),
                city_lat    = CASE WHEN $8::numeric IS NOT NULL THEN $8::numeric ELSE city_lat END,
                city_lng    = CASE WHEN $9::numeric IS NOT NULL THEN $9::numeric ELSE city_lng END
            WHERE id_user = $7`,
            [
                first_name, 
                last_name, 
                birth_date, 
                city, 
                description, 
                id_gender, 
                userId,
                req.body.city_lat !== undefined ? req.body.city_lat : null,
                req.body.city_lng !== undefined ? req.body.city_lng : null
            ]
        );

        if (Array.isArray(sexuality)) {
            await pool.query(`DELETE FROM user_preference WHERE id_user = $1`, [userId]);
            if (sexuality.length > 0) {
                const values = sexuality.map((_, i) => `($1, $${i + 2})`).join(', ');
                await pool.query(
                    `INSERT INTO user_preference (id_user, id_preference) VALUES ${values}`,
                    [userId, ...sexuality]
                );
            }
        }

        if (Array.isArray(photos)) {
            await pool.query(`DELETE FROM photo WHERE id_user = $1`, [userId]);
            const validPhotos = photos.filter(Boolean) as string[];
            if (validPhotos.length > 0) {
                const values = validPhotos.map((_, i) => `($1, $${i + 2})`).join(', ');
                await pool.query(
                    `INSERT INTO photo (id_user, url_photo) VALUES ${values}`,
                    [userId, ...validPhotos]
                );
                
                // Sincronizamos la avatar_url en la tabla users
                await pool.query(
                    `UPDATE users SET avatar_url = $1 WHERE id_user = $2`,
                    [validPhotos[0], userId]
                );
            } else {
                // Si borra todas las fotos, limpiamos el avatar
                await pool.query(
                    `UPDATE users SET avatar_url = NULL WHERE id_user = $1`,
                    [userId]
                );
            }
        }

        if (Array.isArray(interests)) {
            await pool.query(`DELETE FROM user_interest WHERE id_user = $1`, [userId]);
            if (interests.length > 0) {
                const values = interests.map((_, i) => `($1, $${i + 2})`).join(', ');
                await pool.query(
                    `INSERT INTO user_interest (id_user, id_interest) VALUES ${values}`,
                    [userId, ...interests]
                );
            }
        }

        if (Array.isArray(neurodivergences)) {
            await pool.query(`DELETE FROM user_feature WHERE id_user = $1`, [userId]);
            if (neurodivergences.length > 0) {
                const values = neurodivergences.map((_, i) => `($1, $${i + 2})`).join(', ');
                await pool.query(
                    `INSERT INTO user_feature (id_user, id_feature) VALUES ${values}`,
                    [userId, ...neurodivergences]
                );
            }
        }

        if (Array.isArray(communication_style)) {
            await pool.query(`DELETE FROM user_communication_style WHERE id_user = $1`, [userId]);
            if (communication_style.length > 0) {
                const values = communication_style.map((_, i) => `($1, $${i + 2})`).join(', ');
                await pool.query(
                    `INSERT INTO user_communication_style (id_user, id_communication) VALUES ${values}`,
                    [userId, ...communication_style]
                );
            }
        }

        const result = await pool.query(PROFILE_QUERY, [userId]);
        await invalidateUserExploreCache(userId);
        res.status(200).json({ success: true, user: result.rows[0] });

    } catch (error) {
        console.error("Error al actualizar perfil:", error);
        const message = error instanceof Error ? error.message : 'Error interno';
        const isValidation = message !== 'Error interno' && message !== 'Error al actualizar perfil';
        res.status(isValidation ? 400 : 500).json({ success: false, message: isValidation ? message : 'Error interno' });
    }
};


export const getExploreUsers = async (req: AuthRequest, res: Response) => {
    try {
        await ensureMatchTable();
        await ensureDiscoverySeenTable();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const exploreCacheKey = buildExploreCacheKey(userId, req.query as Record<string, unknown>);
        const cachedExplore = await cacheGetJson<{
            success: boolean;
            count: number;
            users: unknown[];
            hasMore: boolean;
            nextCursor: number | null;
            limit: number;
        }>(exploreCacheKey);

        if (cachedExplore) {
            return res.status(200).json(cachedExplore);
        }

        const currentProfileResult = await pool.query(
            `SELECT
                u.id_gender,
                COALESCE(
                    (SELECT up.id_preference FROM user_preference up WHERE up.id_user = u.id_user LIMIT 1),
                    u.id_preference::integer
                )::integer AS id_preference,
                u.city_lat,
                u.city_lng
             FROM users u
             WHERE u.id_user = $1`,
            [userId]
        );

        const currentProfile = currentProfileResult.rows[0];
        const currentGender = Number(currentProfile?.id_gender);
        const currentPreference = Number(currentProfile?.id_preference);
        const currentUserLat = currentProfile?.city_lat ? Number(currentProfile.city_lat) : null;
        const currentUserLng = currentProfile?.city_lng ? Number(currentProfile.city_lng) : null;

        const { city, distance, feature, sensory, search, interests, communicationStyle, cursor, limit, excludeSeen } = req.query;

        const parsedCursor = Number(cursor);
        const parsedLimit = Number(limit);
        const cursorValue = Number.isInteger(parsedCursor) && parsedCursor > 0 ? parsedCursor : null;
        const pageSize = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
        const maxDistance = Number(distance);
        const shouldExcludeSeen = String(excludeSeen ?? 'true').toLowerCase() !== 'false';

        const toArray = (value: unknown): string[] => {
            if (!value) return [];
            if (Array.isArray(value)) {
                return value
                    .flatMap((item) => String(item).split(','))
                    .map((item) => item.trim())
                    .filter(Boolean);
            }

            return String(value)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
        };

        const sensoryFilters = toArray(sensory).map((item) => item.toLowerCase());
        const interestFilters = toArray(interests).map((item) => item.toLowerCase());
        const communicationFilters = toArray(communicationStyle).map((item) => item.toLowerCase());
        const effectiveCandidatePreferenceSql = `COALESCE(
            (SELECT up.id_preference FROM user_preference up WHERE up.id_user = u.id_user LIMIT 1),
            u.id_preference::integer
        )::integer`;

        const addCompatibilityFilter = () => {
            if (!Number.isInteger(currentGender) || !Number.isInteger(currentPreference)) {
                return;
            }

            if (currentGender === 3 || currentGender === 4) {
                return;
            }

            if (currentPreference === 1 && (currentGender === 1 || currentGender === 2)) {
                queryText += ` AND u.id_gender IS NOT NULL AND u.id_gender <> $${paramCount}`;
                queryParams.push(currentGender);
                paramCount++;
                queryText += ` AND ${effectiveCandidatePreferenceSql} NOT IN (3, 4)`;
                return;
            }

            if (currentPreference === 3 && currentGender === 1) {
                queryText += ` AND u.id_gender = $${paramCount}`;
                queryParams.push(currentGender);
                paramCount++;
                queryText += ` AND ${effectiveCandidatePreferenceSql} IN (3, 2, 5, 6, 7)`;
                return;
            }

            if (currentPreference === 4 && currentGender === 2) {
                queryText += ` AND u.id_gender = $${paramCount}`;
                queryParams.push(currentGender);
                paramCount++;
                queryText += ` AND ${effectiveCandidatePreferenceSql} IN (4, 2, 5, 6, 7)`;
            }
        };

        let queryText = `
            SELECT
                u.id_user, 
                u.first_name, 
                u.last_name,      
                u.birth_date,     
                u.city, 
                u.description, 
                u.id_gender,      
                u.id_preference,  
                u.avatar_url as main_photo,
                COALESCE(json_agg(DISTINCT i.name) FILTER (WHERE i.name IS NOT NULL), '[]') as interests,
                COALESCE(json_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '[]') as features,
                COALESCE(
                    (SELECT json_agg(cat.name) 
                    FROM user_communication_style ucs 
                    JOIN communication_style cat ON ucs.id_communication = cat.id_communication 
                    WHERE ucs.id_user = u.id_user), 
                    '[]'
                ) as communication_style,
                COALESCE(
                    (SELECT json_agg(url_photo) FROM photo WHERE id_user = u.id_user),
                    '[]'
                ) as photos
            FROM users u
            LEFT JOIN user_interest ui ON u.id_user = ui.id_user
            LEFT JOIN interest i ON ui.id_interest = i.id_interest
            LEFT JOIN user_feature uf ON u.id_user = uf.id_user
            LEFT JOIN feature f ON uf.id_feature = f.id_feature
                        WHERE u.id_user != $1
                            AND u.is_verified = true
                            AND u.is_visible = true
                            AND NOT EXISTS (
                                        SELECT 1
                                        FROM match m
                                        WHERE (
                                                (m.id_user = $1 AND m.id_matched = u.id_user)
                                                OR (m.id_user = u.id_user AND m.id_matched = $1)
                                        )
                            )
                            AND NOT EXISTS (
                                        SELECT 1 
                                        FROM block b 
                                        WHERE (b.id_user = $1 AND b.id_blocked = u.id_user) 
                                           OR (b.id_user = u.id_user AND b.id_blocked = $1)
                            )
        `;

        const queryParams: any[] = [userId];
        let paramCount = 2;

        addCompatibilityFilter();

        if (search) {
            queryText += ` AND (
                u.first_name ILIKE $${paramCount}
                OR u.last_name ILIKE $${paramCount}
                OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $${paramCount}
                OR COALESCE(u.description, '') ILIKE $${paramCount}
            )`;
            queryParams.push(`%${String(search).trim()}%`);
            paramCount++;
        }

        if (city) {
            queryText += ` AND u.city ILIKE $${paramCount}`;
            queryParams.push(`%${String(city).trim()}%`);
            paramCount++;
        }

        if (maxDistance > 0 && currentUserLat !== null && currentUserLng !== null) {
            queryText += ` AND (
                6371 * acos(
                    cos(radians($${paramCount})) * cos(radians(u.city_lat)) * 
                    cos(radians(u.city_lng) - radians($${paramCount + 1})) + 
                    sin(radians($${paramCount})) * sin(radians(u.city_lat))
                )
            ) <= $${paramCount + 2}`;
            queryParams.push(currentUserLat, currentUserLng, maxDistance);
            paramCount += 3;
        }

        if (feature) {
            queryText += `
                AND EXISTS (
                    SELECT 1
                    FROM user_feature uf2
                    JOIN feature f2 ON uf2.id_feature = f2.id_feature
                    WHERE uf2.id_user = u.id_user
                    AND f2.name = $${paramCount}
                )
            `;
            queryParams.push(feature);
            paramCount++;
        }

        if (sensoryFilters.length > 0) {
            queryText += `
                AND EXISTS (
                    SELECT 1
                    FROM user_feature uf3
                    JOIN feature f3 ON uf3.id_feature = f3.id_feature
                    WHERE uf3.id_user = u.id_user
                    AND LOWER(f3.name) = ANY($${paramCount}::text[])
                )
            `;
            queryParams.push(sensoryFilters);
            paramCount++;
        }

        if (interestFilters.length > 0) {
            queryText += `
                AND EXISTS (
                    SELECT 1
                    FROM user_interest ui2
                    JOIN interest i2 ON i2.id_interest = ui2.id_interest
                    WHERE ui2.id_user = u.id_user
                    AND LOWER(i2.name) = ANY($${paramCount}::text[])
                )
            `;
            queryParams.push(interestFilters);
            paramCount++;
        }

        if (communicationFilters.length > 0) {
            queryText += `
                AND EXISTS (
                    SELECT 1
                    FROM user_communication_style ucs2
                    JOIN communication_style cs2 ON cs2.id_communication = ucs2.id_communication
                    WHERE ucs2.id_user = u.id_user
                    AND LOWER(cs2.name) = ANY($${paramCount}::text[])
                )
            `;
            queryParams.push(communicationFilters);
            paramCount++;
        }

        if (shouldExcludeSeen) {
            queryText += `
                AND NOT EXISTS (
                    SELECT 1
                    FROM user_discovery_seen uds
                    WHERE uds.id_user = $1
                      AND uds.seen_user_id = u.id_user
                )
            `;
        }

        if (cursorValue) {
            queryText += ` AND u.id_user < $${paramCount}`;
            queryParams.push(cursorValue);
            paramCount++;
        }

        queryText += ` GROUP BY u.id_user, u.first_name, u.last_name, u.birth_date, u.city, u.description, u.id_gender, u.id_preference, u.avatar_url, u.city_lat, u.city_lng`;

        if (maxDistance > 0 && currentUserLat !== null && currentUserLng !== null) {
            queryText += ` ORDER BY (
                6371 * acos(
                    cos(radians($${paramCount})) * cos(radians(u.city_lat)) * 
                    cos(radians(u.city_lng) - radians($${paramCount + 1})) + 
                    sin(radians($${paramCount})) * sin(radians(u.city_lat))
                )
            ) ASC, u.id_user DESC`;
            queryParams.push(currentUserLat, currentUserLng);
            paramCount += 2;
        } else {
            queryText += ` ORDER BY u.id_user DESC`;
        }

        queryText += ` LIMIT $${paramCount}`;
        queryParams.push(pageSize + 1);

        const result = await pool.query(queryText, queryParams);

        const hasMore = result.rows.length > pageSize;
        const users = hasMore ? result.rows.slice(0, pageSize) : result.rows;
        const nextCursor = hasMore && users.length > 0 ? users[users.length - 1].id_user : null;

        const payload = {
            success: true,
            count: users.length,
            users,
            hasMore,
            nextCursor,
            limit: pageSize,
        };

        await cacheSetJson(exploreCacheKey, payload, cacheConfig.exploreTtlSeconds);
        res.status(200).json(payload);

    } catch (error) {
        console.error("Error en explorar:", error);
        res.status(500).json({ success: false, message: "Error al filtrar usuarios" });
    }
};


export const deleteAccount = async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const parsed = deleteAccountSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        const { password } = parsed.data;

        if (!password) {
            return res.status(400).json({ success: false, message: "La contraseña es obligatoria" });
        }

        const result = await client.query(
            'SELECT password FROM users WHERE id_user = $1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado" });
        }

        const isMatch = await bcrypt.compare(password, result.rows[0].password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        await client.query('BEGIN');

        await client.query('DELETE FROM user_communication_style WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM user_preference       WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM user_interest         WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM user_feature          WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM photo                 WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM users                 WHERE id_user = $1', [userId]);

        await client.query('COMMIT');

        await invalidateUserExploreCache(userId);

        res.status(200).json({ success: true, message: "Cuenta eliminada correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error al eliminar cuenta:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    } finally {
        client.release();
    }
};


export const updatePrivacy = async (req: AuthRequest, res: Response) => {
    try {
        await ensurePrivacyColumns();

        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const parsed = updatePrivacySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        const { is_visible, messages_only_matches, show_online_status } = parsed.data;

        await pool.query(
            `UPDATE users
            SET
                is_visible             = COALESCE($1, is_visible),
                messages_only_matches  = COALESCE($2, messages_only_matches),
                show_online_status     = COALESCE($3, show_online_status)
            WHERE id_user = $4`,
            [is_visible ?? null, messages_only_matches ?? null, show_online_status ?? null, userId]
        );

        await invalidateUserExploreCache(userId);

        if (show_online_status !== undefined) {
            handleUserVisibilityChange(userId, show_online_status);
        }

        const result = await pool.query(
            'SELECT is_visible, messages_only_matches, show_online_status FROM users WHERE id_user = $1',
            [userId]
        );

        res.status(200).json({ success: true, privacy: result.rows[0] });

    } catch (error) {
        console.error("Error al actualizar privacidad:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};


export const getPrivacy = async (req: AuthRequest, res: Response) => {
    try {
        await ensurePrivacyColumns();

        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const result = await pool.query(
            'SELECT is_visible, messages_only_matches, show_online_status FROM users WHERE id_user = $1',
            [userId]
        );

        res.status(200).json({ success: true, privacy: result.rows[0] });

    } catch (error) {
        console.error("Error al obtener privacidad:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

export const markDiscoverUserSeen = async (req: AuthRequest, res: Response) => {
    try {
        await ensureDiscoverySeenTable();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const parsed = markSeenSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        const { seenUserId, action } = parsed.data;

        if (!Number.isInteger(seenUserId) || seenUserId <= 0 || seenUserId === userId) {
            return res.status(400).json({ success: false, message: 'seenUserId inválido' });
        }

        await pool.query(
            `
                INSERT INTO user_discovery_seen (id_user, seen_user_id, action)
                VALUES ($1, $2, $3)
                ON CONFLICT (id_user, seen_user_id)
                DO UPDATE SET action = EXCLUDED.action, seen_at = NOW()
            `,
            [userId, seenUserId, action]
        );

        await invalidateUserExploreCache(userId);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error en markDiscoverUserSeen:', error);
        return res.status(500).json({ success: false, message: 'Error al registrar perfil visto' });
    }
};

export const getUserProfile = async (req: AuthRequest, res: Response) => {
    try {
        const requestingUserId = Number(req.user?.sub);
        const targetUserId = Number(req.params.userId);

        if (!Number.isInteger(requestingUserId) || requestingUserId <= 0) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
            return res.status(400).json({ success: false, message: 'Usuario inválido' });
        }

        // Permitir ver el perfil si hay un match pendiente o aceptado entre los dos usuarios
        const matchCheck = await pool.query(
            `
                SELECT status FROM match 
                WHERE ((id_user = $1 AND id_matched = $2) OR (id_user = $2 AND id_matched = $1))
                  AND status IN ('pending', 'accepted')
                LIMIT 1
            `,
            [requestingUserId, targetUserId]
        );

        if (matchCheck.rows.length === 0) {
            return res.status(403).json({ success: false, message: 'No tienes acceso a este perfil' });
        }

        // Obtener perfil del usuario
        const userResult = await pool.query(
            `
                SELECT
                    u.id_user,
                    u.first_name,
                    u.last_name,
                    u.birth_date,
                    u.city,
                    u.id_gender,
                    u.id_preference,
                    u.description,
                    u.is_visible,
                    u.messages_only_matches,
                    u.created_at,
                    u.avatar_url
                FROM users u
                WHERE u.id_user = $1 AND u.is_verified = true
            `,
            [targetUserId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        const user = userResult.rows[0];

        // Obtener fotos
        const photosResult = await pool.query(
            `
                SELECT url_photo as main_photo
                FROM photo
                WHERE id_user = $1
                ORDER BY is_primary DESC, id_photo ASC
            `,
            [targetUserId]
        );

        const photos = photosResult.rows.map((row: any) => row.main_photo);

        // Obtener intereses
        const interestsResult = await pool.query(
            `
                SELECT i.name
                FROM user_interest ui
                JOIN interest i ON ui.id_interest = i.id_interest
                WHERE ui.id_user = $1
                ORDER BY i.name ASC
            `,
            [targetUserId]
        );

        const interests = interestsResult.rows.map((row: any) => row.name);

        // Obtener rasgos (features)
        const featuresResult = await pool.query(
            `
                SELECT f.name
                FROM user_feature uf
                JOIN feature f ON uf.id_feature = f.id_feature
                WHERE uf.id_user = $1
                ORDER BY f.name ASC
            `,
            [targetUserId]
        );

        const features = featuresResult.rows.map((row: any) => row.name);

        // Obtener estilos de comunicación
        const communicationResult = await pool.query(
            `
                SELECT cs.name
                FROM user_communication_style ucs
                JOIN communication_style cs ON ucs.id_communication = cs.id_communication
                WHERE ucs.id_user = $1
                ORDER BY cs.name ASC
            `,
            [targetUserId]
        );

        const communicationStyle = communicationResult.rows.map((row: any) => row.name);

        return res.status(200).json({
            success: true,
            user: {
                id_user: user.id_user,
                first_name: user.first_name,
                last_name: user.last_name,
                birth_date: user.birth_date,
                city: user.city,
                id_gender: user.id_gender,
                id_preference: user.id_preference,
                description: user.description,
                main_photo: photos[0] || null,
                photos,
                interests,
                features,
                communication_style: communicationStyle,
            }
        });
    } catch (error) {
        console.error('Error en getUserProfile:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener perfil' });
    }
};

const ensureAccessibilityPrefsTable = async () => {
    if (!accessibilityPrefsReadyPromise) {
        accessibilityPrefsReadyPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_accessibility_preferences (
                    id_user INTEGER PRIMARY KEY REFERENCES users(id_user) ON DELETE CASCADE,
                    contrast VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (contrast IN ('normal', 'high')),
                    reduce_motion BOOLEAN NOT NULL DEFAULT false,
                    font_size VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (font_size IN ('normal', 'large', 'xlarge')),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
        })();
    }

    await accessibilityPrefsReadyPromise;
};

export const getAccessibilityPreferences = async (req: AuthRequest, res: Response) => {
    try {
        await ensureAccessibilityPrefsTable();

        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        await pool.query(
            `
                INSERT INTO user_accessibility_preferences (id_user)
                VALUES ($1)
                ON CONFLICT (id_user) DO NOTHING
            `,
            [userId]
        );

        const result = await pool.query(
            `
                SELECT contrast, reduce_motion, font_size
                FROM user_accessibility_preferences
                WHERE id_user = $1
            `,
            [userId]
        );

        return res.status(200).json({ success: true, accessibility: result.rows[0] });
    } catch (error) {
        console.error('Error al obtener accesibilidad:', error);
        return res.status(500).json({ success: false, message: 'Error interno' });
    }
};

export const updateAccessibilityPreferences = async (req: AuthRequest, res: Response) => {
    try {
        await ensureAccessibilityPrefsTable();

        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const parsed = updateAccessibilitySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        await pool.query(
            `
                INSERT INTO user_accessibility_preferences (id_user)
                VALUES ($1)
                ON CONFLICT (id_user) DO NOTHING
            `,
            [userId]
        );

        const { contrast, reduce_motion, font_size } = parsed.data;

        await pool.query(
            `
                UPDATE user_accessibility_preferences
                SET
                    contrast = COALESCE($1, contrast),
                    reduce_motion = COALESCE($2, reduce_motion),
                    font_size = COALESCE($3, font_size),
                    updated_at = NOW()
                WHERE id_user = $4
            `,
            [contrast ?? null, reduce_motion ?? null, font_size ?? null, userId]
        );

        const result = await pool.query(
            `
                SELECT contrast, reduce_motion, font_size
                FROM user_accessibility_preferences
                WHERE id_user = $1
            `,
            [userId]
        );

        return res.status(200).json({ success: true, accessibility: result.rows[0] });
    } catch (error) {
        console.error('Error al actualizar accesibilidad:', error);
        return res.status(500).json({ success: false, message: 'Error interno' });
    }
};
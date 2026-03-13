import { pool } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { Response } from 'express';
import bcrypt from 'bcrypt';

// ─── Query reutilizable ───────────────────────────────────────────────────────

const PROFILE_QUERY = `
    SELECT 
        u.id_user,
        u.email,
        u.first_name,
        u.last_name,
        u.birth_date,
        u.city,
        u.description,
        u.id_gender,
        COALESCE(
            json_agg(DISTINCT up.id_preference) FILTER (WHERE up.id_preference IS NOT NULL),
            '[]'
        ) AS sexuality,
        COALESCE(
            json_agg(DISTINCT p.url_photo) FILTER (WHERE p.url_photo IS NOT NULL),
            '[]'
        ) AS photos,
        COALESCE(
            json_agg(DISTINCT ui.id_interest) FILTER (WHERE ui.id_interest IS NOT NULL),
            '[]'
        ) AS interests,
        COALESCE(
            json_agg(DISTINCT uf.id_feature) FILTER (WHERE uf.id_feature IS NOT NULL),
            '[]'
        ) AS neurodivergences,
        COALESCE(
            json_agg(DISTINCT ucs.id_communication) FILTER (WHERE ucs.id_communication IS NOT NULL),
            '[]'
        ) AS communication_style
    FROM users u
    LEFT JOIN user_preference up ON u.id_user = up.id_user
    LEFT JOIN photo p ON u.id_user = p.id_user
    LEFT JOIN user_interest ui ON u.id_user = ui.id_user
    LEFT JOIN user_feature uf ON u.id_user = uf.id_user
    LEFT JOIN user_communication_style ucs ON u.id_user = ucs.id_user
    WHERE u.id_user = $1
    GROUP BY u.id_user
`;

// ─── GET /api/users/profile ───────────────────────────────────────────────────

export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

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

// ─── PUT /api/users/profile ───────────────────────────────────────────────────

export const updateProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

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
            sexuality,           // number[] — IDs de preference
            photos,              // (string | null)[]
            interests,           // number[]
            neurodivergences,    // number[]
            communication_style, // number[] — IDs de communication_style
        } = req.body;

        // ── 1. Campos básicos ──────────────────────────────────────────────────
        await pool.query(
            `UPDATE users
             SET
                first_name  = COALESCE($1, first_name),
                last_name   = COALESCE($2, last_name),
                birth_date  = COALESCE($3, birth_date),
                city        = COALESCE($4, city),
                description = COALESCE($5, description),
                id_gender   = COALESCE($6, id_gender)
             WHERE id_user = $7`,
            [first_name, last_name, birth_date, city, description, id_gender, userId]
        );

        // ── 2. Orientación sexual (user_preference) ────────────────────────────
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

        // ── 3. Fotos ───────────────────────────────────────────────────────────
        if (Array.isArray(photos)) {
            await pool.query(`DELETE FROM photo WHERE id_user = $1`, [userId]);
            const validPhotos = photos.filter(Boolean) as string[];
            if (validPhotos.length > 0) {
                const values = validPhotos.map((_, i) => `($1, $${i + 2})`).join(', ');
                await pool.query(
                    `INSERT INTO photo (id_user, url_photo) VALUES ${values}`,
                    [userId, ...validPhotos]
                );
            }
        }

        // ── 4. Intereses ───────────────────────────────────────────────────────
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

        // ── 5. Neurodivergencias ───────────────────────────────────────────────
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

        // ── 6. Estilo de comunicación (user_communication_style) ──────────────
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

        // ── 7. Devolver perfil actualizado ─────────────────────────────────────
        const result = await pool.query(PROFILE_QUERY, [userId]);
        res.status(200).json({ success: true, user: result.rows[0] });

    } catch (error) {
        console.error("Error al actualizar perfil:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

// ─── GET /api/users/explore ───────────────────────────────────────────────────

export const getExploreUsers = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { city, feature, sensory } = req.query;

        let queryText = `
            SELECT
                u.id_user, u.first_name, u.city, u.description,
                (SELECT url_photo FROM photo WHERE id_user = u.id_user LIMIT 1) as main_photo,
                COALESCE(json_agg(DISTINCT i.name) FILTER (WHERE i.name IS NOT NULL), '[]') as interests,
                COALESCE(json_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '[]') as features
            FROM users u
            LEFT JOIN user_interest ui ON u.id_user = ui.id_user
            LEFT JOIN interest i ON ui.id_interest = i.id_interest
            LEFT JOIN user_feature uf ON u.id_user = uf.id_user
            LEFT JOIN feature f ON uf.id_feature = f.id_feature
            WHERE u.id_user != $1 AND u.is_verified = true
        `;

        const queryParams: any[] = [userId];
        let paramCount = 2;

        if (city) {
            queryText += ` AND u.city = $${paramCount}`;
            queryParams.push(city);
            paramCount++;
        }

        if (feature) {
            queryText += ` AND f.name = $${paramCount}`;
            queryParams.push(feature);
            paramCount++;
        }

        if (sensory) {
            queryText += ` AND f.name = $${paramCount}`;
            queryParams.push(sensory);
            paramCount++;
        }

        queryText += ` GROUP BY u.id_user LIMIT 20`;

        const result = await pool.query(queryText, queryParams);
        res.status(200).json({ success: true, count: result.rows.length, users: result.rows });

    } catch (error) {
        console.error("Error en explorar:", error);
        res.status(500).json({ success: false, message: "Error al filtrar usuarios" });
    }
};


// ─── DELETE /api/users/profile ────────────────────────────────────────────────

export const deleteAccount = async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ success: false, message: "La contraseña es obligatoria" });
        }

        // Verificar que la contraseña es correcta
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

        // Borrar en orden para respetar las foreign keys
        await client.query('BEGIN');

        await client.query('DELETE FROM user_communication_style WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM user_preference       WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM user_interest         WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM user_feature          WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM photo                 WHERE id_user = $1', [userId]);
        await client.query('DELETE FROM users                 WHERE id_user = $1', [userId]);

        await client.query('COMMIT');

        res.status(200).json({ success: true, message: "Cuenta eliminada correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error al eliminar cuenta:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    } finally {
        client.release();
    }
};

// ─── PATCH /api/users/privacy ─────────────────────────────────────────────────

export const updatePrivacy = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const { is_visible, messages_only_matches } = req.body;

        await pool.query(
            `UPDATE users
             SET
                is_visible             = COALESCE($1, is_visible),
                messages_only_matches  = COALESCE($2, messages_only_matches)
             WHERE id_user = $3`,
            [is_visible ?? null, messages_only_matches ?? null, userId]
        );

        const result = await pool.query(
            'SELECT is_visible, messages_only_matches FROM users WHERE id_user = $1',
            [userId]
        );

        res.status(200).json({ success: true, privacy: result.rows[0] });

    } catch (error) {
        console.error("Error al actualizar privacidad:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

// ─── GET /api/users/privacy ───────────────────────────────────────────────────

export const getPrivacy = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const result = await pool.query(
            'SELECT is_visible, messages_only_matches FROM users WHERE id_user = $1',
            [userId]
        );

        res.status(200).json({ success: true, privacy: result.rows[0] });

    } catch (error) {
        console.error("Error al obtener privacidad:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};
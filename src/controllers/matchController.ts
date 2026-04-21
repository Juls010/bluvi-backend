import { Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { emitToUser } from '../services/socket';

const sendRequestSchema = z.object({
    targetUserId: z.number().int().positive(),
    icebreakerMessage: z.string().trim().min(3).max(280),
});

const respondSchema = z.object({
    action: z.enum(['accept', 'reject']),
});

let schemaReadyPromise: Promise<void> | null = null;
let chatArtifactsReadyPromise: Promise<void> | null = null;

const ensureMatchTable = async () => {
    if (!schemaReadyPromise) {
        schemaReadyPromise = (async () => {
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

            await pool.query('CREATE INDEX IF NOT EXISTS idx_match_target_status ON match (id_matched, status)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_match_requester_status ON match (id_user, status)');
        })();
    }

    await schemaReadyPromise;
};

const ensureChatArtifacts = async () => {
    if (!chatArtifactsReadyPromise) {
        chatArtifactsReadyPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS chat (
                    id_chat SERIAL PRIMARY KEY,
                    id_user1 INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    id_user2 INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT no_self_chat CHECK (id_user1 <> id_user2)
                )
            `);

            await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_pair_unique ON chat (LEAST(id_user1, id_user2), GREATEST(id_user1, id_user2))');
        })();
    }

    await chatArtifactsReadyPromise;
};

const ensureChatExists = async (userA: number, userB: number) => {
    await ensureChatArtifacts();

    const firstUser = Math.min(userA, userB);
    const secondUser = Math.max(userA, userB);

    await pool.query(
        `
            INSERT INTO chat (id_user1, id_user2, start_date)
            VALUES ($1, $2, NOW())
            ON CONFLICT DO NOTHING
        `,
        [firstUser, secondUser]
    );
};

export const sendMatchRequest = async (req: AuthRequest, res: Response) => {
    try {
        await ensureMatchTable();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const parsed = sendRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: 'Datos inválidos', issues: parsed.error.issues });
        }

        const { targetUserId, icebreakerMessage } = parsed.data;

        if (targetUserId === userId) {
            return res.status(400).json({ success: false, message: 'No puedes enviarte una solicitud a ti misma/o' });
        }

        const targetExists = await pool.query('SELECT id_user FROM users WHERE id_user = $1 AND is_verified = true', [targetUserId]);
        if (targetExists.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'La persona seleccionada no existe o no está verificada' });
        }

        const existingSameDirection = await pool.query(
            `SELECT id_match, status FROM match WHERE id_user = $1 AND id_matched = $2`,
            [userId, targetUserId]
        );

        if (existingSameDirection.rows.length > 0) {
            const existing = existingSameDirection.rows[0];

            if (existing.status === 'accepted') {
                return res.status(200).json({ success: true, alreadyMatched: true, message: 'Ya tenéis un match activo' });
            }

            await pool.query(
                `
                    UPDATE match
                    SET message = $1,
                        status = 'pending',
                        created_at = NOW(),
                        updated_at = NULL
                    WHERE id_match = $2
                `,
                [icebreakerMessage, existing.id_match]
            );

            return res.status(200).json({ success: true, pending: true, message: 'Solicitud actualizada y reenviada' });
        }

        const existingOppositeDirection = await pool.query(
            `
                SELECT id_match, status
                FROM match
                WHERE id_user = $1 AND id_matched = $2
            `,
            [targetUserId, userId]
        );

        if (existingOppositeDirection.rows.length > 0) {
            const opposite = existingOppositeDirection.rows[0];

            if (opposite.status === 'accepted') {
                return res.status(200).json({ success: true, alreadyMatched: true, message: 'Ya tenéis un match activo' });
            }

            await pool.query(
                `
                    UPDATE match
                    SET status = 'accepted', updated_at = NOW()
                    WHERE id_match = $1
                `,
                [opposite.id_match]
            );

            await ensureChatExists(userId, targetUserId);

            emitToUser(targetUserId, 'match:accepted', { userId });
            emitToUser(userId, 'match:accepted', { userId: targetUserId });

            return res.status(200).json({ success: true, matched: true, message: '¡Match mutuo! Ya podéis hablar' });
        }

        await pool.query(
            `
                INSERT INTO match (id_user, id_matched, message, status)
                VALUES ($1, $2, $3, 'pending')
            `,
            [userId, targetUserId, icebreakerMessage]
        );

        emitToUser(targetUserId, 'match:request:new', { fromUserId: userId });

        return res.status(201).json({ success: true, pending: true, message: 'Icebreaker enviado. Esperando respuesta' });
    } catch (error) {
        console.error('Error en sendMatchRequest:', error);
        return res.status(500).json({ success: false, message: 'Error al enviar solicitud' });
    }
};

export const getIncomingRequests = async (req: AuthRequest, res: Response) => {
    try {
        await ensureMatchTable();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const result = await pool.query(
            `
                SELECT
                    m.id_match,
                    m.message,
                    m.created_at,
                    u.id_user,
                    u.first_name,
                    u.last_name,
                    (SELECT url_photo FROM photo WHERE id_user = u.id_user ORDER BY is_primary DESC, id_photo ASC LIMIT 1) AS main_photo
                FROM match m
                JOIN users u ON u.id_user = m.id_user
                WHERE m.id_matched = $1 AND m.status = 'pending'
                ORDER BY m.created_at DESC
            `,
            [userId]
        );

        return res.status(200).json({ success: true, requests: result.rows });
    } catch (error) {
        console.error('Error en getIncomingRequests:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener solicitudes' });
    }
};

export const respondToMatchRequest = async (req: AuthRequest, res: Response) => {
    try {
        await ensureMatchTable();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const requestId = Number(req.params.id);
        if (!Number.isInteger(requestId) || requestId <= 0) {
            return res.status(400).json({ success: false, message: 'ID de solicitud inválido' });
        }

        const parsed = respondSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: 'Acción inválida' });
        }

        const status = parsed.data.action === 'accept' ? 'accepted' : 'rejected';

        const result = await pool.query(
            `
                UPDATE match
                SET status = $1,
                    updated_at = NOW()
                WHERE id_match = $2
                  AND id_matched = $3
                  AND status = 'pending'
                RETURNING id_match, status
            `,
            [status, requestId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Solicitud no encontrada o ya respondida' });
        }

        if (status === 'accepted') {
            const counterpart = await pool.query(
                'SELECT id_user FROM match WHERE id_match = $1',
                [requestId]
            );

            const requesterId = counterpart.rows[0]?.id_user;
            if (requesterId) {
                await ensureChatExists(userId, requesterId);

                emitToUser(requesterId, 'match:accepted', { userId });
                emitToUser(userId, 'match:accepted', { userId: requesterId });
            }
        }

        return res.status(200).json({
            success: true,
            matchEnabled: status === 'accepted',
            status,
            message: status === 'accepted' ? 'Solicitud aceptada, chat desbloqueado' : 'Solicitud rechazada',
        });
    } catch (error) {
        console.error('Error en respondToMatchRequest:', error);
        return res.status(500).json({ success: false, message: 'Error al responder solicitud' });
    }
};

export const getMyMatches = async (req: AuthRequest, res: Response) => {
    try {
        await ensureMatchTable();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const result = await pool.query(
            `
                SELECT
                    m.id_match,
                    m.created_at,
                    m.updated_at,
                    m.message,
                    CASE WHEN m.id_user = $1 THEN m.id_matched ELSE m.id_user END AS id_user,
                    u.first_name,
                    u.last_name,
                    (SELECT url_photo FROM photo WHERE id_user = u.id_user ORDER BY is_primary DESC, id_photo ASC LIMIT 1) AS main_photo
                FROM match m
                JOIN users u ON u.id_user = CASE WHEN m.id_user = $1 THEN m.id_matched ELSE m.id_user END
                WHERE (m.id_user = $1 OR m.id_matched = $1)
                  AND m.status = 'accepted'
                ORDER BY COALESCE(m.updated_at, m.created_at) DESC
            `,
            [userId]
        );

        return res.status(200).json({ success: true, matches: result.rows });
    } catch (error) {
        console.error('Error en getMyMatches:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener matches' });
    }
};

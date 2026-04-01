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

const ensureMatchSchema = async () => {
    if (!schemaReadyPromise) {
        schemaReadyPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS match_request (
                    id_request SERIAL PRIMARY KEY,
                    requester_id INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    target_id INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    icebreaker_message TEXT NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    responded_at TIMESTAMPTZ,
                    CONSTRAINT uniq_match_direction UNIQUE (requester_id, target_id),
                    CONSTRAINT no_self_match CHECK (requester_id <> target_id)
                )
            `);

            await pool.query('CREATE INDEX IF NOT EXISTS idx_match_request_target_status ON match_request (target_id, status)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_match_request_requester_status ON match_request (requester_id, status)');
        })();
    }

    await schemaReadyPromise;
};

export const sendMatchRequest = async (req: AuthRequest, res: Response) => {
    try {
        await ensureMatchSchema();

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
            `SELECT id_request, status FROM match_request WHERE requester_id = $1 AND target_id = $2`,
            [userId, targetUserId]
        );

        if (existingSameDirection.rows.length > 0) {
            const existing = existingSameDirection.rows[0];

            if (existing.status === 'accepted') {
                return res.status(200).json({ success: true, alreadyMatched: true, message: 'Ya tenéis un match activo' });
            }

            await pool.query(
                `
                    UPDATE match_request
                    SET icebreaker_message = $1,
                        status = 'pending',
                        created_at = NOW(),
                        responded_at = NULL
                    WHERE id_request = $2
                `,
                [icebreakerMessage, existing.id_request]
            );

            return res.status(200).json({ success: true, pending: true, message: 'Solicitud actualizada y reenviada' });
        }

        const existingOppositeDirection = await pool.query(
            `
                SELECT id_request, status
                FROM match_request
                WHERE requester_id = $1 AND target_id = $2
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
                    UPDATE match_request
                    SET status = 'accepted', responded_at = NOW()
                    WHERE id_request = $1
                `,
                [opposite.id_request]
            );

            emitToUser(targetUserId, 'match:accepted', { userId });
            emitToUser(userId, 'match:accepted', { userId: targetUserId });

            return res.status(200).json({ success: true, matched: true, message: '¡Match mutuo! Ya podéis hablar' });
        }

        await pool.query(
            `
                INSERT INTO match_request (requester_id, target_id, icebreaker_message, status)
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
        await ensureMatchSchema();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const result = await pool.query(
            `
                SELECT
                    mr.id_request,
                    mr.icebreaker_message,
                    mr.created_at,
                    u.id_user,
                    u.first_name,
                    u.last_name,
                    (SELECT url_photo FROM photo WHERE id_user = u.id_user ORDER BY is_primary DESC, id_photo ASC LIMIT 1) AS main_photo
                FROM match_request mr
                JOIN users u ON u.id_user = mr.requester_id
                WHERE mr.target_id = $1 AND mr.status = 'pending'
                ORDER BY mr.created_at DESC
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
        await ensureMatchSchema();

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
                UPDATE match_request
                SET status = $1,
                    responded_at = NOW()
                WHERE id_request = $2
                  AND target_id = $3
                  AND status = 'pending'
                RETURNING id_request, status
            `,
            [status, requestId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Solicitud no encontrada o ya respondida' });
        }

        if (status === 'accepted') {
            const counterpart = await pool.query(
                'SELECT requester_id FROM match_request WHERE id_request = $1',
                [requestId]
            );

            const requesterId = counterpart.rows[0]?.requester_id;
            if (requesterId) {
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
        await ensureMatchSchema();

        const userId = req.user?.sub;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const result = await pool.query(
            `
                SELECT
                    mr.id_request,
                    mr.created_at,
                    mr.responded_at,
                    mr.icebreaker_message,
                    CASE WHEN mr.requester_id = $1 THEN mr.target_id ELSE mr.requester_id END AS id_user,
                    u.first_name,
                    u.last_name,
                    (SELECT url_photo FROM photo WHERE id_user = u.id_user ORDER BY is_primary DESC, id_photo ASC LIMIT 1) AS main_photo
                FROM match_request mr
                JOIN users u ON u.id_user = CASE WHEN mr.requester_id = $1 THEN mr.target_id ELSE mr.requester_id END
                WHERE (mr.requester_id = $1 OR mr.target_id = $1)
                  AND mr.status = 'accepted'
                ORDER BY COALESCE(mr.responded_at, mr.created_at) DESC
            `,
            [userId]
        );

        return res.status(200).json({ success: true, matches: result.rows });
    } catch (error) {
        console.error('Error en getMyMatches:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener matches' });
    }
};

import { Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { emitToUser, isUserOnline } from '../services/socket';

const sendMessageSchema = z.object({
    message: z.string().trim().min(1).max(1000),
});

let chatSchemaReadyPromise: Promise<void> | null = null;

const ensureChatSchema = async () => {
    if (!chatSchemaReadyPromise) {
        chatSchemaReadyPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS chat (
                    id_chat SERIAL PRIMARY KEY,
                    id_user1 INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    id_user2 INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT no_self_chat CHECK (id_user1 <> id_user2)
                )
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS message (
                    id_message SERIAL PRIMARY KEY,
                    id_chat INTEGER NOT NULL REFERENCES chat(id_chat) ON DELETE CASCADE,
                    id_sender INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    content TEXT NOT NULL,
                    date_sent TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS chat_read_state (
                    id_chat INTEGER NOT NULL REFERENCES chat(id_chat) ON DELETE CASCADE,
                    id_user INTEGER NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
                    last_read_message_id INTEGER,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (id_chat, id_user)
                )
            `);

            await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_pair_unique ON chat (LEAST(id_user1, id_user2), GREATEST(id_user1, id_user2))');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_user1 ON chat (id_user1)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_user2 ON chat (id_user2)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_message_chat_date ON message (id_chat, date_sent DESC, id_message DESC)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_message_sender ON message (id_sender)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_read_state_user ON chat_read_state (id_user, id_chat)');
        })();
    }

    await chatSchemaReadyPromise;
};

const hasAcceptedMatch = async (userId: number, otherUserId: number) => {
    const matchResult = await pool.query(
        `
            SELECT 1
            FROM match
            WHERE status = 'accepted'
              AND ((id_user = $1 AND id_matched = $2) OR (id_user = $2 AND id_matched = $1))
            LIMIT 1
        `,
        [userId, otherUserId]
    );

    return matchResult.rows.length > 0;
};

const getExistingChatId = async (userId: number, otherUserId: number) => {
    const chatResult = await pool.query(
        `
            SELECT id_chat
            FROM chat
            WHERE (id_user1 = $1 AND id_user2 = $2)
               OR (id_user1 = $2 AND id_user2 = $1)
            LIMIT 1
        `,
        [userId, otherUserId]
    );

    return chatResult.rows[0]?.id_chat as number | undefined;
};

const getOrCreateChatId = async (userId: number, otherUserId: number) => {
    const currentChatId = await getExistingChatId(userId, otherUserId);
    if (currentChatId) {
        return currentChatId;
    }

    const firstUser = Math.min(userId, otherUserId);
    const secondUser = Math.max(userId, otherUserId);

    try {
        const inserted = await pool.query(
            `
                INSERT INTO chat (id_user1, id_user2, start_date)
                VALUES ($1, $2, NOW())
                RETURNING id_chat
            `,
            [firstUser, secondUser]
        );

        return inserted.rows[0].id_chat as number;
    } catch {
        const existingAfterConflict = await getExistingChatId(userId, otherUserId);
        if (!existingAfterConflict) {
            throw new Error('No se pudo crear ni encontrar el chat');
        }
        return existingAfterConflict;
    }
};

const getCounterpart = async (otherUserId: number) => {
    const result = await pool.query(
        `
            SELECT
                u.id_user,
                u.first_name,
                u.last_name,
                (SELECT url_photo FROM photo WHERE id_user = u.id_user ORDER BY is_primary DESC, id_photo ASC LIMIT 1) AS main_photo
            FROM users u
            WHERE u.id_user = $1
            LIMIT 1
        `,
        [otherUserId]
    );

    return result.rows[0] ?? null;
};

const getReadCursor = async (chatId: number, userId: number) => {
    const result = await pool.query(
        `
            SELECT COALESCE(last_read_message_id, 0)::int AS last_read_message_id
            FROM chat_read_state
            WHERE id_chat = $1 AND id_user = $2
            LIMIT 1
        `,
        [chatId, userId]
    );

    return Number(result.rows[0]?.last_read_message_id || 0);
};

export const getConversations = async (req: AuthRequest, res: Response) => {
    try {
        await ensureChatSchema();

        const userId = Number(req.user?.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const result = await pool.query(
            `
                WITH active_chats AS (
                    SELECT
                        c.id_chat,
                        c.start_date,
                        CASE WHEN c.id_user1 = $1 THEN c.id_user2 ELSE c.id_user1 END AS counterpart_id
                    FROM chat c
                    WHERE c.id_user1 = $1 OR c.id_user2 = $1
                )
                SELECT
                    ac.id_chat AS chat_id,
                    u.id_user,
                    u.first_name,
                    u.last_name,
                    (SELECT url_photo FROM photo WHERE id_user = u.id_user ORDER BY is_primary DESC, id_photo ASC LIMIT 1) AS main_photo,
                    lm.content AS last_message,
                    lm.date_sent AS last_message_at,
                    lm.id_sender AS last_message_sender_id,
                    COALESCE((
                        SELECT COUNT(*)::int
                        FROM message m
                        LEFT JOIN chat_read_state crs ON crs.id_chat = ac.id_chat AND crs.id_user = $1
                        WHERE m.id_chat = ac.id_chat
                          AND m.id_sender <> $1
                          AND m.id_message > COALESCE(crs.last_read_message_id, 0)
                    ), 0) AS unread_count
                FROM active_chats ac
                JOIN users u ON u.id_user = ac.counterpart_id
                LEFT JOIN LATERAL (
                    SELECT m.content, m.date_sent, m.id_sender
                    FROM message m
                    WHERE m.id_chat = ac.id_chat
                    ORDER BY m.date_sent DESC, m.id_message DESC
                    LIMIT 1
                ) lm ON true
                ORDER BY COALESCE(lm.date_sent, ac.start_date) DESC
            `,
            [userId]
        );

        return res.status(200).json({ success: true, conversations: result.rows });
    } catch (error) {
        console.error('Error en getConversations:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener conversaciones' });
    }
};

export const getConversationMessages = async (req: AuthRequest, res: Response) => {
    try {
        await ensureChatSchema();

        const userId = Number(req.user?.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const otherUserId = Number(req.params.userId);
        if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
            return res.status(400).json({ success: false, message: 'Usuario de chat inválido' });
        }

        const limitParam = Number(req.query.limit);
        const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;
        const beforeIdParam = Number(req.query.beforeId);
        const beforeId = Number.isInteger(beforeIdParam) && beforeIdParam > 0 ? beforeIdParam : null;

        const accepted = await hasAcceptedMatch(userId, otherUserId);
        if (!accepted) {
            return res.status(403).json({ success: false, message: 'No existe un match activo para este chat' });
        }

        const chatId = await getOrCreateChatId(userId, otherUserId);
        const otherUserReadCursor = await getReadCursor(chatId, otherUserId);

        const counterpart = await getCounterpart(otherUserId);

        const fetchLimit = limit + 1;
        const messagesParams: Array<number> = [chatId, userId, otherUserReadCursor, fetchLimit];
        let messagesQuery = `
                SELECT
                    m.id_message,
                    m.id_chat AS chat_id,
                    m.id_sender AS sender_id,
                    CASE WHEN m.id_sender = $2 THEN $3 ELSE $2 END AS receiver_id,
                    m.content,
                    m.date_sent AS created_at,
                    NULL::timestamptz AS read_at,
                    CASE
                        WHEN m.id_sender = $2 AND m.id_message <= $3 THEN true
                        ELSE false
                    END AS is_read
                FROM message m
                WHERE m.id_chat = $1
        `;

        if (beforeId) {
            messagesQuery += ` AND m.id_message < $5`;
            messagesParams.push(beforeId);
        }

        messagesQuery += `
                ORDER BY m.date_sent DESC, m.id_message DESC
                LIMIT $4
        `;

        const messagesResult = await pool.query(messagesQuery, messagesParams);
        const hasMore = messagesResult.rows.length > limit;
        const messages = hasMore ? messagesResult.rows.slice(0, limit).reverse() : messagesResult.rows.reverse();

        await pool.query(
            `
                INSERT INTO chat_read_state (id_chat, id_user, last_read_message_id, updated_at)
                VALUES (
                    $1,
                    $2,
                    (SELECT COALESCE(MAX(m.id_message), 0) FROM message m WHERE m.id_chat = $1 AND m.id_sender = $3),
                    NOW()
                )
                ON CONFLICT (id_chat, id_user)
                DO UPDATE SET
                    last_read_message_id = GREATEST(
                        COALESCE(chat_read_state.last_read_message_id, 0),
                        COALESCE((SELECT MAX(m.id_message) FROM message m WHERE m.id_chat = $1 AND m.id_sender = $3), 0)
                    ),
                    updated_at = NOW()
            `,
            [chatId, userId, otherUserId]
        );

        return res.status(200).json({
            success: true,
            counterpart,
            chatId,
            otherUserReadCursor,
            hasMore,
            messages,
        });
    } catch (error) {
        console.error('Error en getConversationMessages:', error);
        return res.status(500).json({ success: false, message: 'Error al obtener mensajes' });
    }
};

export const sendConversationMessage = async (req: AuthRequest, res: Response) => {
    try {
        await ensureChatSchema();

        const userId = Number(req.user?.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const otherUserId = Number(req.params.userId);
        if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
            return res.status(400).json({ success: false, message: 'Usuario de chat inválido' });
        }

        const parsed = sendMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: 'Mensaje inválido', issues: parsed.error.issues });
        }

        const accepted = await hasAcceptedMatch(userId, otherUserId);
        if (!accepted) {
            return res.status(403).json({ success: false, message: 'No existe un match activo para este chat' });
        }

        const chatId = await getOrCreateChatId(userId, otherUserId);
        const otherUserReadCursor = await getReadCursor(chatId, otherUserId);

        const messageResult = await pool.query(
            `
                INSERT INTO message (id_chat, id_sender, content, date_sent)
                VALUES ($1, $2, $3, NOW())
                RETURNING
                    id_message,
                    id_chat AS chat_id,
                    id_sender AS sender_id,
                    $4::integer AS receiver_id,
                    content,
                    date_sent AS created_at,
                    NULL::timestamptz AS read_at
            `,
            [chatId, userId, parsed.data.message, otherUserId]
        );

        const message = messageResult.rows[0];

        message.is_read = message.id_message <= otherUserReadCursor;

        await pool.query(
            `
                INSERT INTO chat_read_state (id_chat, id_user, last_read_message_id, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (id_chat, id_user)
                DO UPDATE SET
                    last_read_message_id = GREATEST(COALESCE(chat_read_state.last_read_message_id, 0), EXCLUDED.last_read_message_id),
                    updated_at = NOW()
            `,
            [chatId, userId, message.id_message]
        );

        emitToUser(otherUserId, 'chat:message:new', {
            fromUserId: userId,
            message,
        });

        return res.status(201).json({ success: true, message });
    } catch (error) {
        console.error('Error en sendConversationMessage:', error);
        return res.status(500).json({ success: false, message: 'Error al enviar mensaje' });
    }
};

export const markConversationRead = async (req: AuthRequest, res: Response) => {
    try {
        await ensureChatSchema();

        const userId = Number(req.user?.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const otherUserId = Number(req.params.userId);
        if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
            return res.status(400).json({ success: false, message: 'Usuario de chat inválido' });
        }

        const accepted = await hasAcceptedMatch(userId, otherUserId);
        if (!accepted) {
            return res.status(403).json({ success: false, message: 'No existe un match activo para este chat' });
        }

        const chatId = await getOrCreateChatId(userId, otherUserId);

        const maxIncomingMessageResult = await pool.query(
            `
                SELECT COALESCE(MAX(m.id_message), 0)::int AS max_id
                FROM message m
                WHERE m.id_chat = $1
                  AND m.id_sender = $2
            `,
            [chatId, otherUserId]
        );

        const maxIncomingMessageId = Number(maxIncomingMessageResult.rows[0]?.max_id || 0);

        const unreadBeforeReadResult = await pool.query(
            `
                SELECT COUNT(*)::int AS unread
                FROM message m
                LEFT JOIN chat_read_state crs ON crs.id_chat = m.id_chat AND crs.id_user = $3
                WHERE m.id_chat = $1
                  AND m.id_sender = $2
                  AND m.id_message > COALESCE(crs.last_read_message_id, 0)
            `,
            [chatId, otherUserId, userId]
        );

        await pool.query(
            `
                INSERT INTO chat_read_state (id_chat, id_user, last_read_message_id, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (id_chat, id_user)
                DO UPDATE SET
                    last_read_message_id = GREATEST(COALESCE(chat_read_state.last_read_message_id, 0), EXCLUDED.last_read_message_id),
                    updated_at = NOW()
            `,
            [chatId, userId, maxIncomingMessageId]
        );

        emitToUser(otherUserId, 'chat:messages:read', {
            byUserId: userId,
            chatUserId: otherUserId,
            lastReadMessageId: maxIncomingMessageId,
        });

        return res.status(200).json({ success: true, updated: Number(unreadBeforeReadResult.rows[0]?.unread || 0) });
    } catch (error) {
        console.error('Error en markConversationRead:', error);
        return res.status(500).json({ success: false, message: 'Error al marcar mensajes como leidos' });
    }
};

export const checkUserOnlineStatus = async (req: AuthRequest, res: Response) => {
    try {
        const userId = Number(req.user?.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ success: false, message: 'Usuario no identificado' });
        }

        const otherUserId = Number(req.params.userId);
        if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
            return res.status(400).json({ success: false, message: 'Usuario de chat inválido' });
        }

        const accepted = await hasAcceptedMatch(userId, otherUserId);
        if (!accepted) {
            return res.status(403).json({ success: false, message: 'No existe un match activo para este chat' });
        }

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS show_online_status BOOLEAN NOT NULL DEFAULT true
        `);

        const preferenceResult = await pool.query(
            `
                SELECT show_online_status
                FROM users
                WHERE id_user = $1
                LIMIT 1
            `,
            [otherUserId]
        );

        if (preferenceResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        const showOnlineStatus = Boolean(preferenceResult.rows[0]?.show_online_status);
        if (!showOnlineStatus) {
            return res.status(200).json({
                success: true,
                isOnline: false,
                canShowOnlineStatus: false,
                userId: otherUserId,
            });
        }

        const isOnline = isUserOnline(otherUserId);

        return res.status(200).json({
            success: true,
            isOnline,
            canShowOnlineStatus: true,
            userId: otherUserId,
        });
    } catch (error) {
        console.error('Error en checkUserOnlineStatus:', error);
        return res.status(500).json({ success: false, message: 'Error al verificar estado de usuario' });
    }
};

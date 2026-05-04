import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';
import { pool } from '../config/db';

let io: Server | null = null;
const connectedUsers = new Map<number, Set<string>>();
const invisibleUsers = new Set<number>(); 

export const initSocket = (httpServer: HttpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: 'http://localhost:5173',
            credentials: true,
        },
    });

    io.use((socket, next) => {
        const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
        const headerAuth = typeof socket.handshake.headers?.authorization === 'string' ? socket.handshake.headers.authorization : '';
        const raw = authToken || (headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : '');

        const payload = raw ? verifyAccessToken(raw) : null;
        if (!payload?.sub) {
            return next(new Error('Unauthorized socket'));
        }

        socket.data.userId = Number(payload.sub);
        return next();
    });

    io.on('connection', async (socket) => {
        const userId = socket.data.userId;
        if (userId) {
            try {
                const result = await pool.query('SELECT show_online_status FROM users WHERE id_user = $1', [userId]);
                const isVisible = result.rows[0]?.show_online_status ?? true;

                if (!isVisible) {
                    invisibleUsers.add(userId);
                } else {
                    invisibleUsers.delete(userId);
                }
            } catch (err) {
                console.error('Error al comprobar show_online_status en socket:', err);
                invisibleUsers.add(userId);
            }

            socket.join(`user:${userId}`);

            const userSockets = connectedUsers.get(userId) ?? new Set<string>();
            const wasOffline = userSockets.size === 0;
            userSockets.add(socket.id);
            connectedUsers.set(userId, userSockets);

            if (wasOffline && !invisibleUsers.has(userId)) {
                io?.emit('user:online', { userId, timestamp: new Date().toISOString() });
            }

            socket.emit('user:status:initial', { onlineUserIds: getConnectedUsers() });
        }

        socket.on('chat:typing', (payload: { toUserId?: number; chatUserId?: number; isTyping?: boolean }) => {
            const targetUserId = Number(payload?.toUserId ?? payload?.chatUserId);
            if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !userId) {
                return;
            }

            io?.to(`user:${targetUserId}`).emit('chat:typing', {
                fromUserId: userId,
                chatUserId: targetUserId,
                isTyping: Boolean(payload?.isTyping),
            });
        });

        socket.on('chat:typing:stop', (payload: { toUserId?: number; chatUserId?: number }) => {
            const targetUserId = Number(payload?.toUserId ?? payload?.chatUserId);
            if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !userId) {
                return;
            }

            io?.to(`user:${targetUserId}`).emit('chat:typing', {
                fromUserId: userId,
                chatUserId: targetUserId,
                isTyping: false,
            });
        });

        socket.on('disconnect', () => {
            if (userId) {
                const userSockets = connectedUsers.get(userId);
                if (!userSockets) {
                    return;
                }

                userSockets.delete(socket.id);

                if (userSockets.size === 0) {
                    connectedUsers.delete(userId);
                    if (!invisibleUsers.has(userId)) {
                        io?.emit('user:offline', { userId, timestamp: new Date().toISOString() });
                    }
                    invisibleUsers.delete(userId); 
                } else {
                    connectedUsers.set(userId, userSockets);
                }
            }
        });
    });

    return io;
};

export const emitToUser = (userId: number, event: string, payload: unknown) => {
    if (!io) return;
    io.to(`user:${userId}`).emit(event, payload);
};

export const isUserOnline = (userId: number): boolean => {
    if (invisibleUsers.has(userId)) return false;
    return (connectedUsers.get(userId)?.size ?? 0) > 0;
};

export const getConnectedUsers = (): number[] => {
    return Array.from(connectedUsers.keys()).filter(id => !invisibleUsers.has(id));
};

export const handleUserVisibilityChange = (userId: number, isVisible: boolean) => {
    if (isVisible) {
        invisibleUsers.delete(userId);
        if (connectedUsers.has(userId)) {
            io?.emit('user:online', { userId, timestamp: new Date().toISOString() });
        }
    } else {
        invisibleUsers.add(userId);
        if (connectedUsers.has(userId)) {
            io?.emit('user:offline', { userId, timestamp: new Date().toISOString() });
        }
    }
};

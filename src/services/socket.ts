import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';

let io: Server | null = null;
const connectedUsers = new Map<number, string>(); // userId -> socketId

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

    io.on('connection', (socket) => {
        const userId = socket.data.userId;
        if (userId) {
            socket.join(`user:${userId}`);
            connectedUsers.set(userId, socket.id);
            
            // Notificar a todos que este usuario se conectó
            io?.emit('user:online', { userId, timestamp: new Date().toISOString() });
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
                connectedUsers.delete(userId);
                // Notificar a todos que este usuario se desconectó
                io?.emit('user:offline', { userId, timestamp: new Date().toISOString() });
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
    return connectedUsers.has(userId);
};

export const getConnectedUsers = (): number[] => {
    return Array.from(connectedUsers.keys());
};

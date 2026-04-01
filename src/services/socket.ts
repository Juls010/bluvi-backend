import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';

let io: Server | null = null;

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
        }
    });

    return io;
};

export const emitToUser = (userId: number, event: string, payload: unknown) => {
    if (!io) return;
    io.to(`user:${userId}`).emit(event, payload);
};

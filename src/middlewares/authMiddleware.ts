import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: {
        userId: number;
    };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: "Acceso denegado. No se encontró el token de sesión." 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: number };
    
        req.user = { userId: decoded.userId };
        
        next();
    } catch (error) {
        return res.status(403).json({ 
            success: false, 
            message: "Token inválido o expirado." 
        });
    }
};
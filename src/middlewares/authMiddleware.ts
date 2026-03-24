import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/jwt'; 

export interface AuthRequest extends Request {
    user?: any; 
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    console.log("🎫 Header recibido:", authHeader);

    if (!authHeader?.startsWith('Bearer ')) {
        console.log("❌ Formato de header incorrecto");
        return res.status(401).json({ detail: 'Formato incorrecto' });
    }

    const token = authHeader.split(' ')[1]; 

    try {
        const decoded = verifyAccessToken(token);
        console.log("✅ Token verificado. Usuario ID:", decoded.sub);
        req.user = decoded; 
        next(); 
    } catch (error: any) {
        // 🔍 ESTO ES LO QUE NECESITAMOS VER EN LA CONSOLA:
        console.log("❌ ERROR VERIFICANDO TOKEN:", error.message);
        
        return res.status(401).json({ 
            detail: 'Token inválido',
            error: error.message 
        });
    }
};
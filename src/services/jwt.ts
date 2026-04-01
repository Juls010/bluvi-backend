import jwt, { SignOptions } from 'jsonwebtoken';

// 1. Extraemos las variables del entorno una sola vez
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

// 2. Validación de seguridad al arrancar el módulo
if (!ACCESS_SECRET || !REFRESH_SECRET) {
    console.error("❌ ERROR CRÍTICO: Faltan JWT_ACCESS_SECRET o JWT_REFRESH_SECRET en el .env");
}

export const generateTokens = (user: any) => {
    // IMPORTANTE: Aseguramos que el sub sea el ID correcto (id_user en tu DB)
    const userId = user.id_user || user.id;

    if (!userId) {
        console.error("❌ Error: Intentando generar token para un usuario sin ID", user);
    }

    const accessTokenPayload = {
        sub: userId,
        email: user.email,
        role: user.role || 'user' // Coincidiendo con tu columna 'role' de la DB
    };

    const refreshTokenPayload = {
        sub: userId
    };

    // Firmar Access Token
    const accessToken = jwt.sign(
        accessTokenPayload, 
        ACCESS_SECRET as string, 
        { expiresIn: ACCESS_EXPIRY as SignOptions['expiresIn'] }
    );

    // Firmar Refresh Token
    const refreshToken = jwt.sign(
        refreshTokenPayload, 
        REFRESH_SECRET as string, 
        { expiresIn: REFRESH_EXPIRY as SignOptions['expiresIn'] }
    );

    return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string) => {
    try {
        return jwt.verify(token, ACCESS_SECRET as string) as any;
    } catch (error: any) {
        console.log("🔍 Motivo del fallo del token:", error.message); 
        return null;
    }
};

export const verifyRefreshToken = (token: string) => {
    try {
        return jwt.verify(token, REFRESH_SECRET as string) as any;
    } catch (error) {
        throw new Error("Refresh token inválido o expirado");
    }
};
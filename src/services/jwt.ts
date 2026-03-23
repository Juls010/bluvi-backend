import jwt, { SignOptions } from 'jsonwebtoken';

export const generateTokens = (user: any) => {
    const payload = {
        sub: user.id_user,
        username: user.username,
        email: user.email,
        roles: user.roles || ['user']
    };

    // Forzamos el tipo SignOptions para que TypeScript no se queje
    const accessOptions: SignOptions = {
        expiresIn: (process.env.ACCESS_TOKEN_EXPIRY as any) || '15m'
    };

    const refreshOptions: SignOptions = {
        expiresIn: (process.env.REFRESH_TOKEN_EXPIRY as any) || '7d'
    };

    // Usamos '!' para asegurar que la clave no es null o undefined
    const access = jwt.sign(payload, process.env.JWT_SECRET!, accessOptions);

    const refresh = jwt.sign(
        { sub: user.id_user },
        process.env.JWT_REFRESH_SECRET!,
        refreshOptions
    );

    return { access, refresh };
};

export const verifyAccessToken = (token: string) => {
    return jwt.verify(token, process.env.JWT_SECRET!) as any;
};

export const verifyRefreshToken = (token: string) => {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as any;
};
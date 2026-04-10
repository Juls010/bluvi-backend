import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../config/db';
import { sendVerificationEmail } from '../services/emailService';
import { AuthRequest } from '../middlewares/authMiddleware';
import { generateTokens, verifyRefreshToken } from '../services/jwt';
import {
    checkEmailAttemptBlocked,
    checkLoginAttemptBlocked,
    clearEmailFailures,
    clearLoginFailures,
    getClientIp,
    registerEmailFailure,
    registerLoginFailure,
} from '../middlewares/rateLimit';

const SALT_ROUNDS = 10;

const envInt = (value: string | undefined, fallback: number, min = 1) => {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed < min) {
        return fallback;
    }
    return parsed;
};

// Login brute-force protection configuration from environment variables
const LOGIN_GUARD_OPTIONS = {
    windowMs: envInt(process.env.LOGIN_GUARD_WINDOW_MS, 15 * 60 * 1000),
    maxAttempts: envInt(process.env.LOGIN_GUARD_MAX_ATTEMPTS, 5),
    blockMs: envInt(process.env.LOGIN_GUARD_BLOCK_MS, 15 * 60 * 1000),
};

const EMAIL_GUARD_OPTIONS = {
    windowMs: envInt(process.env.EMAIL_GUARD_WINDOW_MS, 30 * 60 * 1000),
    maxAttempts: envInt(process.env.EMAIL_GUARD_MAX_ATTEMPTS, 12),
    blockMs: envInt(process.env.EMAIL_GUARD_BLOCK_MS, 30 * 60 * 1000),
};

const dataUriOrHttpUrl = /^(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+|https?:\/\/\S+)$/;

const checkEmailSchema = z.object({
    email: z.string().trim().email().max(254),
});

const loginSchema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
});

const verifyEmailSchema = z.object({
    email: z.string().trim().email().max(254),
    code: z.string().trim().regex(/^\d{6}$/, 'Codigo invalido'),
});

const registerSchema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72),
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    birth_date: z.string().trim().min(1),
    id_gender: z.coerce.number().int().positive(),
    id_preference: z.coerce.number().int().positive(),
    city: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1200),
    interests: z.array(z.coerce.number().int().positive()).max(50).optional().default([]),
    neurodivergences: z.array(z.coerce.number().int().positive()).max(50).optional().default([]),
    communication_style: z.array(z.coerce.number().int().positive()).max(50).optional().default([]),
    photos: z
        .preprocess(
            (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : value,
            z.array(z.string().trim().min(1).max(2_000_000).regex(dataUriOrHttpUrl, 'Formato de foto invalido')).max(8)
        )
        .optional()
        .default([]),
});

export const getProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.sub; 

        if (!userId) {
            return res.status(401).json({ success: false, message: "Usuario no identificado" });
        }

        const userQuery = `
            SELECT 
                u.id_user as id, u.email, u.first_name, u.last_name, u.birth_date, u.city, u.description,
                COALESCE(json_agg(DISTINCT p.url_photo) FILTER (WHERE p.url_photo IS NOT NULL), '[]') as photos,
                COALESCE(json_agg(DISTINCT i.name) FILTER (WHERE i.name IS NOT NULL), '[]') as interests,
                COALESCE(json_agg(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL), '[]') as neurodivergences
            FROM users u
            LEFT JOIN photo p ON u.id_user = p.id_user
            LEFT JOIN user_interest ui ON u.id_user = ui.id_user
            LEFT JOIN interest i ON ui.id_interest = i.id_interest
            LEFT JOIN user_feature uf ON u.id_user = uf.id_user
            LEFT JOIN feature f ON uf.id_feature = f.id_feature
            WHERE u.id_user = $1
            GROUP BY u.id_user
        `;

        const result = await pool.query(userQuery, [userId]);
        
        res.status(200).json({
            success: true,
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Error al obtener perfil:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

export const checkEmail = async (req: Request, res: Response) => {
    try {
        const parsed = checkEmailSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        const { email } = parsed.data;

        const result = await pool.query('SELECT id_user FROM users WHERE email = $1', [email]);
        
        if (result.rows.length > 0) {
            return res.status(409).json({ exists: true, message: "El email ya está registrado" });
        }
        
        return res.status(200).json({ exists: false, message: "Email disponible" });
    } catch (error) {
        console.error("Error en checkEmail:", error);
        res.status(500).json({ success: false, message: "Error al verificar email" });
    }
};

export const registerStep = async (req: Request, res: Response) => {
        console.log("Datos recibidos en el Back:", req.body);
        const client = await pool.connect();
        
        try {
            const parsed = registerSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    success: false,
                    message: parsed.error.issues[0]?.message || 'Datos invalidos',
                });
            }

            const { 
                email, 
                password, 
                first_name,    
                last_name,    
                birth_date,    
                id_gender,     
                id_preference, 
                city, 
                description, 
                interests, 
                neurodivergences,
                communication_style, 
                photos 
            } = parsed.data;

            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            
            await client.query('BEGIN');

        const userQuery = `
            INSERT INTO users (
                email, password, first_name, last_name, birth_date, 
                id_gender, id_preference, city, description,
                verification_code, code_expires_at, is_verified, role
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id_user
        `;

        const userValues = [
            email.toLowerCase().trim(), 
            hashedPassword, 
            first_name, 
            last_name, 
            birth_date,
            id_gender, 
            id_preference, 
            city, 
            description,
            verificationCode, 
            expiresAt, 
            false, 
            'user'
        ];

        const newUser = await client.query(userQuery, userValues);
        const userId = newUser.rows[0].id_user;

        await client.query(
            'INSERT INTO user_preference (id_user, id_preference) VALUES ($1, $2)',
            [userId, id_preference]
        );

        if (interests && interests.length > 0) {
            for (const interestId of interests) {
                await client.query(
                    'INSERT INTO user_interest (id_user, id_interest) VALUES ($1, $2)',
                    [userId, interestId]
                );
            }
        }

        // Inserción de features/neurodivergencias (IDs numéricos)
        if (neurodivergences && neurodivergences.length > 0) {
            for (const featureId of neurodivergences) {
                await client.query(
                    'INSERT INTO user_feature (id_user, id_feature) VALUES ($1, $2)', 
                    [userId, featureId]
                );
            }
        }

        if (communication_style && Array.isArray(communication_style) && communication_style.length > 0) {
            for (const commId of communication_style) {
                await client.query(
                    'INSERT INTO user_communication_style (id_user, id_communication) VALUES ($1, $2)', 
                    [userId, commId]
                );
            }
        }

        if (photos && Array.isArray(photos)) {
            for (let i = 0; i < photos.length; i++) {
                const photoData = photos[i];
                
                if (photoData) { 
                    const isPrimary = (i === 0); 

                    await client.query(
                        'INSERT INTO photo (id_user, url_photo, is_primary) VALUES ($1, $2, $3)', 
                        [userId, photoData, isPrimary]
                    );
                }
            }
        }

        await client.query('COMMIT');

        try {
            await sendVerificationEmail(email, verificationCode);
        } catch (error){
            if (error instanceof Error) {
                console.log("Error al enviar email, pero seguimos adelante:", error.message);
            } else {
                console.log("Ocurrió un error desconocido al enviar el email");
            }
        }
        

        res.status(201).json({
            success: true,
            message: "Usuario registrado. Código enviado al email.",
            userId 
        });

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error("Error en registro:", error);
        res.status(500).json({ success: false, message: error.message || "Error en el servidor" });
    } finally {
        client.release();
    }
};

const isProduction = process.env.NODE_ENV === 'production';

const cookieOptions: any = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: isProduction ? 'strict' : 'lax', 
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/', 
};

export const login = async (req: Request, res: Response) => {
    console.log("1. Entrando en LOGIN real");
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase().trim();
        const clientIp = getClientIp(req);

        const preCheck = checkLoginAttemptBlocked(normalizedEmail, clientIp, LOGIN_GUARD_OPTIONS);
        if (preCheck.blocked) {
            res.setHeader('Retry-After', String(preCheck.retryAfterSeconds));
            return res.status(429).json({
                success: false,
                message: 'Demasiados intentos de login para esta cuenta desde tu red. Espera unos minutos.',
                retryAfterSeconds: preCheck.retryAfterSeconds,
            });
        }

        const emailPreCheck = checkEmailAttemptBlocked(normalizedEmail, EMAIL_GUARD_OPTIONS);
        if (emailPreCheck.blocked) {
            res.setHeader('Retry-After', String(emailPreCheck.retryAfterSeconds));
            return res.status(429).json({
                success: false,
                message: 'Cuenta temporalmente protegida por demasiados intentos. Espera unos minutos.',
                retryAfterSeconds: emailPreCheck.retryAfterSeconds,
            });
        }

        const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            const state = registerLoginFailure(normalizedEmail, clientIp, LOGIN_GUARD_OPTIONS);
            const emailState = registerEmailFailure(normalizedEmail, EMAIL_GUARD_OPTIONS);
            const retryAfterSeconds = Math.max(state.retryAfterSeconds, emailState.retryAfterSeconds);

            if (state.blocked || emailState.blocked) {
                res.setHeader('Retry-After', String(retryAfterSeconds));
                return res.status(429).json({
                    success: false,
                    message: 'Demasiados intentos de login. Espera unos minutos.',
                    retryAfterSeconds,
                });
            }

            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        clearLoginFailures(normalizedEmail, clientIp);
        clearEmailFailures(normalizedEmail);

        const tokens = generateTokens(user);

        // USAMOS cookieOptions AQUÍ TAMBIÉN
        res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

        return res.status(200).json({
            success: true,
            accessToken: tokens.accessToken,
            user: { id: user.id_user, firstName: user.first_name, email: user.email }
        });
    } catch (error) {
        console.error("Error en login:", error);
        return res.status(500).json({ success: false, message: "Error interno" });
    }
};


export const refresh = async (req: Request, res: Response) => {
    console.log("🚩 Intentando REFRESH silencioso");
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
        console.log("❌ No hay refreshToken en las cookies");
        return res.status(401).json({ success: false, message: 'No hay sesión activa' });
    }

    try {
        const payload = verifyRefreshToken(refreshToken);
        const result = await pool.query('SELECT * FROM users WHERE id_user = $1', [payload.sub]);
        const user = result.rows[0];

        if (!user) return res.status(401).json({ message: 'Usuario no encontrado' });

        const tokens = generateTokens(user);

        // Usamos cookieOptions para renovar la cookie
        res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

        return res.json({ success: true, accessToken: tokens.accessToken });
    } catch (error) {
        console.error("❌ Error verificando Refresh Token:", error);
        return res.status(401).json({ success: false, message: 'Sesión expirada' });
    }
};

export const verifyEmail = async (req: Request, res: Response) => {
    try {
        const parsed = verifyEmailSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message || 'Payload invalido' });
        }

        const { email, code } = parsed.data;
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND verification_code = $2',
            [email, code]
        );
        const user = result.rows[0];

        if (!user) return res.status(401).json({ success: false, message: "Código inválido" });
        
        // ... (check de expiración igual)

        await pool.query(
            'UPDATE users SET is_verified = true, verification_code = NULL, code_expires_at = NULL WHERE id_user = $1',
            [user.id_user]
        );

        const { accessToken, refreshToken } = generateTokens(user);

        // TAMBIÉN USAMOS cookieOptions AQUÍ
        res.cookie('refreshToken', refreshToken, cookieOptions);

        res.status(200).json({
            success: true,
            message: "Email verificado correctamente",
            accessToken,
            user: { id: user.id_user, firstName: user.first_name, email: user.email }
        });

    } catch (error) {
        console.error("Verify Error:", error);
        res.status(500).json({ success: false, message: "Error interno" });
    }
};

export const logout = async (req: Request, res: Response) => {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        path: '/' 
    });
    return res.status(200).json({ success: true, message: "Sesión cerrada" });
};
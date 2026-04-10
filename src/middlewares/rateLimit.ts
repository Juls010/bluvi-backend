import { NextFunction, Request, Response } from 'express';

type RateLimitOptions = {
    windowMs: number;
    max: number;
    message?: string;
    keyStrategy?: 'ip' | 'route-ip';
};

type Bucket = {
    count: number;
    resetAt: number;
};

type LoginAttemptBucket = {
    failCount: number;
    windowResetAt: number;
    blockedUntil?: number;
};

type LoginAttemptOptions = {
    windowMs: number;
    maxAttempts: number;
    blockMs: number;
};

type EmailAttemptBucket = {
    failCount: number;
    windowResetAt: number;
    blockedUntil?: number;
};

type LoginAttemptState = {
    blocked: boolean;
    retryAfterSeconds: number;
};

const ipBuckets = new Map<string, Bucket>();
const loginAttemptBuckets = new Map<string, LoginAttemptBucket>();
const emailAttemptBuckets = new Map<string, EmailAttemptBucket>();

const cleanupBuckets = () => {
    const now = Date.now();
    for (const [key, bucket] of ipBuckets.entries()) {
        if (bucket.resetAt <= now) {
            ipBuckets.delete(key);
        }
    }

    for (const [key, bucket] of loginAttemptBuckets.entries()) {
        const blockExpired = !bucket.blockedUntil || bucket.blockedUntil <= now;
        const windowExpired = bucket.windowResetAt <= now;
        if (blockExpired && windowExpired) {
            loginAttemptBuckets.delete(key);
        }
    }

    for (const [key, bucket] of emailAttemptBuckets.entries()) {
        const blockExpired = !bucket.blockedUntil || bucket.blockedUntil <= now;
        const windowExpired = bucket.windowResetAt <= now;
        if (blockExpired && windowExpired) {
            emailAttemptBuckets.delete(key);
        }
    }
};

setInterval(cleanupBuckets, 60_000).unref();

export const getClientIp = (req: Request) => {
    const cfIp = req.header('cf-connecting-ip');
    if (cfIp) {
        return cfIp.trim().replace(/^::ffff:/, '');
    }

    const forwardedFor = req.header('x-forwarded-for');
    if (forwardedFor) {
        const firstIp = forwardedFor.split(',')[0]?.trim();
        if (firstIp) {
            return firstIp.replace(/^::ffff:/, '');
        }
    }

    // Express resolves req.ip safely when trust proxy is configured.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return ip.replace(/^::ffff:/, '');
};

export const createRateLimiter = (options: RateLimitOptions) => {
    const {
        windowMs,
        max,
        message = 'Demasiadas peticiones. Intentalo de nuevo en unos minutos.',
        keyStrategy = 'ip',
    } = options;

    return (req: Request, res: Response, next: NextFunction) => {
        const now = Date.now();
        const clientIp = getClientIp(req);
        const routeKey = `${req.method}:${req.baseUrl || ''}${req.path}`;
        const key = keyStrategy === 'route-ip' ? `${routeKey}:${clientIp}` : clientIp;

        const existing = ipBuckets.get(key);

        if (!existing || existing.resetAt <= now) {
            ipBuckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (existing.count >= max) {
            const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
            res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
            return res.status(429).json({
                success: false,
                message,
                retryAfterSeconds: Math.max(retryAfterSeconds, 1),
            });
        }

        existing.count += 1;
        ipBuckets.set(key, existing);
        return next();
    };
};

const buildLoginAttemptKey = (email: string, ip: string) => `${email.toLowerCase().trim()}|${ip}`;
const normalizeEmail = (email: string) => email.toLowerCase().trim();

export const checkLoginAttemptBlocked = (
    email: string,
    ip: string,
    options: LoginAttemptOptions
): LoginAttemptState => {
    const now = Date.now();
    const key = buildLoginAttemptKey(email, ip);
    const bucket = loginAttemptBuckets.get(key);

    if (!bucket) {
        return { blocked: false, retryAfterSeconds: 0 };
    }

    if (bucket.blockedUntil && bucket.blockedUntil > now) {
        return {
            blocked: true,
            retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
        };
    }

    if (bucket.windowResetAt <= now) {
        loginAttemptBuckets.delete(key);
        return { blocked: false, retryAfterSeconds: 0 };
    }

    return { blocked: false, retryAfterSeconds: 0 };
};

export const checkEmailAttemptBlocked = (
    email: string,
    options: LoginAttemptOptions
): LoginAttemptState => {
    const now = Date.now();
    const key = normalizeEmail(email);
    const bucket = emailAttemptBuckets.get(key);

    if (!bucket) {
        return { blocked: false, retryAfterSeconds: 0 };
    }

    if (bucket.blockedUntil && bucket.blockedUntil > now) {
        return {
            blocked: true,
            retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
        };
    }

    if (bucket.windowResetAt <= now) {
        emailAttemptBuckets.delete(key);
        return { blocked: false, retryAfterSeconds: 0 };
    }

    return { blocked: false, retryAfterSeconds: 0 };
};

export const registerLoginFailure = (
    email: string,
    ip: string,
    options: LoginAttemptOptions
): LoginAttemptState => {
    const now = Date.now();
    const key = buildLoginAttemptKey(email, ip);
    const current = loginAttemptBuckets.get(key);

    if (!current || current.windowResetAt <= now) {
        const bucket: LoginAttemptBucket = {
            failCount: 1,
            windowResetAt: now + options.windowMs,
        };
        loginAttemptBuckets.set(key, bucket);
        return { blocked: false, retryAfterSeconds: 0 };
    }

    if (current.blockedUntil && current.blockedUntil > now) {
        return {
            blocked: true,
            retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil - now) / 1000)),
        };
    }

    current.failCount += 1;
    if (current.failCount >= options.maxAttempts) {
        current.blockedUntil = now + options.blockMs;
        loginAttemptBuckets.set(key, current);
        return {
            blocked: true,
            retryAfterSeconds: Math.max(1, Math.ceil(options.blockMs / 1000)),
        };
    }

    loginAttemptBuckets.set(key, current);
    return { blocked: false, retryAfterSeconds: 0 };
};

export const registerEmailFailure = (
    email: string,
    options: LoginAttemptOptions
): LoginAttemptState => {
    const now = Date.now();
    const key = normalizeEmail(email);
    const current = emailAttemptBuckets.get(key);

    if (!current || current.windowResetAt <= now) {
        const bucket: EmailAttemptBucket = {
            failCount: 1,
            windowResetAt: now + options.windowMs,
        };
        emailAttemptBuckets.set(key, bucket);
        return { blocked: false, retryAfterSeconds: 0 };
    }

    if (current.blockedUntil && current.blockedUntil > now) {
        return {
            blocked: true,
            retryAfterSeconds: Math.max(1, Math.ceil((current.blockedUntil - now) / 1000)),
        };
    }

    current.failCount += 1;
    if (current.failCount >= options.maxAttempts) {
        current.blockedUntil = now + options.blockMs;
        emailAttemptBuckets.set(key, current);
        return {
            blocked: true,
            retryAfterSeconds: Math.max(1, Math.ceil(options.blockMs / 1000)),
        };
    }

    emailAttemptBuckets.set(key, current);
    return { blocked: false, retryAfterSeconds: 0 };
};

export const clearLoginFailures = (email: string, ip: string) => {
    const key = buildLoginAttemptKey(email, ip);
    loginAttemptBuckets.delete(key);
};

export const clearEmailFailures = (email: string) => {
    emailAttemptBuckets.delete(normalizeEmail(email));
};

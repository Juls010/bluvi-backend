import cookieParser from 'cookie-parser';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes';
import interestRoutes from './routes/interestRoutes';
import userRoutes from './routes/userRoutes';
import matchRoutes from './routes/matchRoutes';
import chatRoutes from './routes/chatRoutes';
import transcriptionRoutes from './routes/transcriptionRoutes';
import storageRoutes from './routes/storageRoutes';
import { createRateLimiter } from './middlewares/rateLimit';

const app = express();

const isProduction = process.env.NODE_ENV === 'production';

const envInt = (value: string | undefined, fallback: number, min = 1) => {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
};

const parseAllowedOrigins = () => {
  const raw = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN;
  if (!raw) {
    return isProduction ? [] : ['http://localhost:5173'];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const allowedOrigins = parseAllowedOrigins();
const cloudflareEnabled = process.env.CLOUDFLARE_ENABLED === 'true';

const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv === 'true') {
  app.set('trust proxy', 1);
} else if (trustProxyEnv && !Number.isNaN(Number(trustProxyEnv))) {
  app.set('trust proxy', Number(trustProxyEnv));
} else if (cloudflareEnabled) {
  // Cloudflare forwards the real client IP via CF-Connecting-IP.
  // trust proxy allows Express to resolve req.ip correctly behind edge proxies.
  app.set('trust proxy', 1);
}

// Rate limiter configuration from environment variables with sensible defaults
const RATE_LIMIT_CONFIG = {
  // Global API limiter: 120 requests per minute per IP
  global: {
    windowMs: envInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS, 60_000),
    max: envInt(process.env.RATE_LIMIT_GLOBAL_MAX, 120),
  },
  // Auth endpoints limiter: 30 requests per 15 min per IP
  auth: {
    windowMs: envInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
    max: envInt(process.env.RATE_LIMIT_AUTH_MAX, 30),
  },
  // Login endpoint limiter: 10 requests per 15 min per IP
  login: {
    windowMs: envInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000),
    max: envInt(process.env.RATE_LIMIT_LOGIN_MAX, 10),
  },
  // Register endpoint limiter: 8 requests per hour per IP
  register: {
    windowMs: envInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS, 60 * 60 * 1000),
    max: envInt(process.env.RATE_LIMIT_REGISTER_MAX, 8),
  },
};

const globalApiLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.global.windowMs,
  max: RATE_LIMIT_CONFIG.global.max,
  message: 'Demasiadas peticiones en poco tiempo. Intentalo en un minuto.',
  keyStrategy: 'ip',
});

const authLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
  max: RATE_LIMIT_CONFIG.auth.max,
  message: 'Demasiados intentos de autenticacion. Espera 15 minutos.',
  keyStrategy: 'ip',
});

const loginLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.login.windowMs,
  max: RATE_LIMIT_CONFIG.login.max,
  message: 'Demasiados intentos de login. Espera 15 minutos.',
  keyStrategy: 'ip',
});

const registerLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.register.windowMs,
  max: RATE_LIMIT_CONFIG.register.max,
  message: 'Demasiados intentos de registro. Vuelve a intentarlo mas tarde.',
  keyStrategy: 'ip',
});

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200,
};

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', globalApiLimiter);

app.use('/api/auth', authLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);

app.use('/api/interests', interestRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/transcriptions', transcriptionRoutes);
app.use('/api/storage', storageRoutes);


app.get('/', (req, res) => {
    res.send('Servidor de Bluvi funcionando');
});

export default app; 
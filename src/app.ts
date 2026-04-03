import dotenv from 'dotenv';
dotenv.config();  
import cookieParser from 'cookie-parser';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import interestRoutes from './routes/interestRoutes';
import userRoutes from './routes/userRoutes';
import matchRoutes from './routes/matchRoutes';
import chatRoutes from './routes/chatRoutes';

const app = express();

const corsOptions = {
    origin: 'http://localhost:5173', 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    optionsSuccessStatus: 200 
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use('/api/interests', interestRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/chats', chatRoutes);


app.get('/', (req, res) => {
    res.send('Servidor de Bluvi funcionando');
});

export default app; 
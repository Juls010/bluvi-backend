import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import interestRoutes from './routes/interestRoutes';
import userRoutes from './routes/userRoutes';

const app = express();

// Middlewares
app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

app.use(express.json());

// Agrupamos nuestras rutas
app.use('/api/interests', interestRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);


app.get('/', (req, res) => {
    res.send('Servidor de Bluvi funcionando');
});

export default app; 
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import interestRoutes from './routes/interestRoutes';

const app = express();

app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());

// Agrupamos nuestras rutas
app.use('/api/auth', authRoutes);
app.use('/api/interests', interestRoutes); // Ahora será: http://localhost:3000/api/interests

app.get('/', (req, res) => {
  res.send('Servidor de Bluvi funcionando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
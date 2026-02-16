import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';

const app = express();
const port = 3000;

const pool = new Pool({
  user: 'bluvi_user',
  host: '127.0.0.1',
  database: 'bluvi_database',
  password: 'bluvi_password',
  port: 5432,
});

app.use(cors({
  origin: 'http://localhost:5173', // Permite que tu React entre
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());


app.get('/intereses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM interest ORDER BY name ASC');
    res.json(result.rows); 
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener intereses' });
  }
});

// Ruta básica de bienvenida
app.get('/', (req, res) => {
  res.send('Servidor de Bluvi funcionando');
});

app.listen(port, () => {
  console.log(`\n\n  Servidor corriendo en http://localhost:${port}`);
  console.log(`Prueba los datos en: http://localhost:${port}/intereses`);
});

app.use(cors());
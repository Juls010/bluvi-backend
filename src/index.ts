import 'dotenv/config'; 
import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor de Bluvi corriendo en http://localhost:${PORT}`);
  console.log(`Rutas de autenticación en http://localhost:${PORT}/api/auth`);
});
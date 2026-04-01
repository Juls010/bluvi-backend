import 'dotenv/config'; 
import app from './app';
import { createServer } from 'http';
import { initSocket } from './services/socket';

const PORT = process.env.PORT || 3000;

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Servidor de Bluvi corriendo en http://localhost:${PORT}`);
  console.log(`Rutas de autenticación en http://localhost:${PORT}/api/auth`);
});
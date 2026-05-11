import 'dotenv/config'; 
import app from './app';
import { createServer } from 'http';
import { initSocket } from './services/socket';
import { closeCache, initCache, isCacheEnabled } from './services/cache';
import { startRegistrationCleanup } from './services/registrationCleanup';

const PORT = process.env.PORT || 3000;

const httpServer = createServer(app);
initSocket(httpServer);
let registrationCleanupTimer: NodeJS.Timeout | null = null;

const start = async () => {
  await initCache();
  registrationCleanupTimer = startRegistrationCleanup();

  httpServer.listen(PORT, () => {
  console.log(`Servidor de Bluvi corriendo en http://localhost:${PORT}`);
  console.log(`Rutas de autenticación en http://localhost:${PORT}/api/auth`);
  if (isCacheEnabled()) {
    console.log('Cache Redis habilitada');
  }
  });
};

const gracefulShutdown = async () => {
  if (registrationCleanupTimer) {
    clearInterval(registrationCleanupTimer);
  }
  await closeCache();
  httpServer.close(() => process.exit(0));
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

start().catch((error) => {
  console.error('Error al iniciar servidor:', error);
  process.exit(1);
});

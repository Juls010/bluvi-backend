import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import storageController from '../controllers/storageController';

const router = Router();

// POST /api/storage/signed-url
router.post('/signed-url', authenticateToken, storageController.signedUrl);

export default router;

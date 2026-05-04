import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import transcriptionController from '../controllers/transcriptionController';

const router = Router();

// POST /api/transcriptions
router.post('/', authenticateToken, transcriptionController.transcribe);

export default router;

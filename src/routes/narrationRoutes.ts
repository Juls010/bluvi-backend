import { Router } from 'express';
import { synthesizeNarration } from '../controllers/narrationController';

const router = Router();

router.post('/speech', synthesizeNarration);

export default router;

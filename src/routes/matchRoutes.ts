import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import {
    getIncomingRequests,
    getMyMatches,
    respondToMatchRequest,
    sendMatchRequest,
} from '../controllers/matchController';

const router = Router();

router.post('/requests', authenticateToken, sendMatchRequest);
router.get('/requests/incoming', authenticateToken, getIncomingRequests);
router.patch('/requests/:id/respond', authenticateToken, respondToMatchRequest);
router.get('/', authenticateToken, getMyMatches);

export default router;

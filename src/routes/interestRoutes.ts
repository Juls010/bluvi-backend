import { Router } from 'express';
import { getInterests } from '../controllers/interestController';

const router = Router();

router.get('/', getInterests);

export default router;
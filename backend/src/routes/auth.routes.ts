import { Router, type Request, type Response, type NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { loginSchema, successResponse, errorResponse } from '../models/schemas.js';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticate and receive a JWT token.
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const result = await AuthService.login(parsed.username, parsed.password);

    if (!result) {
      res.status(401).json(errorResponse('Invalid username or password'));
      return;
    }

    res.json(successResponse(result));
  } catch (err) {
    // Delegate to error.middleware.ts: ZodError → 400 with field messages,
    // anything else → 500 with the message redacted in production. Handling
    // errors locally here leaked raw internal error text to unauthenticated
    // callers regardless of NODE_ENV.
    next(err);
  }
});

export default router;

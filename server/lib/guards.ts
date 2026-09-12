import type { RequestHandler } from 'express';
import type { AppConfig } from '../config.ts';
import type { UserRepository, UserRecord } from '../store/userStore.ts';
import { computeNextStep, isIdentityVerified, acceptCompletedPolicy } from '../flow.ts';
import { forbidden, unauthenticated } from './errors.ts';
import { stepIndex } from '../../shared/flow.ts';

/** Resolves the signed-in user (if any) onto `res.locals.user`. */
export function attachUser(users: UserRepository): RequestHandler {
  return async (req, res, next) => {
    const userId = req.session.userId;
    if (userId) {
      const user = await users.get(userId);
      if (user) res.locals.user = user;
      else delete req.session.userId; // stale cookie after a server restart
    }
    next();
  };
}

export const requireUser: RequestHandler = (_req, res, next) => {
  if (!res.locals.user) return next(unauthenticated());
  next();
};

export function requireVerified(config: AppConfig): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user;
    if (!user) return next(unauthenticated());
    if (!isIdentityVerified(user.identity.status, acceptCompletedPolicy(config))) {
      return next(forbidden('Identity verification must be completed first.'));
    }
    next();
  };
}

/** Requires the user to have progressed at least to `step`. */
export function requireProgress(config: AppConfig, step: Parameters<typeof stepIndex>[0]): RequestHandler {
  return (_req, res, next) => {
    const user = res.locals.user;
    if (!user) return next(unauthenticated());
    if (stepIndex(computeNextStep(user, config)) < stepIndex(step)) {
      return next(forbidden('Complete the previous onboarding steps first.'));
    }
    next();
  };
}

export function currentUser(res: { locals: { user?: UserRecord } }): UserRecord {
  const user = res.locals.user;
  if (!user) throw unauthenticated();
  return user;
}

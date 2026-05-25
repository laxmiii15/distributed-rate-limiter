import { Request } from 'express';

/**
 * Identify the caller for bucketing. An API key (if present) is the most
 * meaningful unit to limit on; otherwise fall back to client IP.
 *
 * NOTE: IP only means anything if Express `trust proxy` is set correctly for
 * your deployment — behind a load balancer the real client IP is in
 * X-Forwarded-For, and a naive setup would limit the *proxy*, not the user.
 * main.ts configures this.
 */
export function clientId(req: Request): string {
  const apiKey = req.header('x-api-key');
  if (apiKey) return `key:${apiKey}`;
  return `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
}

import { PROTOCOL_VERSION } from '@sinf/shared';

/** Placeholder until step S1.3 adds Fastify, SQLite and `/health`. */
export function describeServer(): string {
  return `Sinf server skeleton (protocol v${PROTOCOL_VERSION}). HTTP server arrives in step S1.3.`;
}

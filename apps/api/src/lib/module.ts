import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.js'
import type { JobDefinition } from './jobs.js'

declare module 'fastify' {
  interface FastifyInstance {
    config: Config
  }
}

/**
 * A feature module: its routes (registered in an encapsulated Fastify scope) and, optionally, the background
 * jobs it defines (started by server.ts). Other modules may import only modules/<name>/index.ts.
 */
export interface ApiModule {
  readonly name: string
  register(app: FastifyInstance): void | Promise<void>
  readonly jobs?: readonly JobDefinition[]
}

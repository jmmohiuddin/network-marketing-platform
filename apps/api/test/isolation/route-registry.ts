// The routes a Fastify instance registers, collected by an onRoute hook installed the moment the instance is created,
// so buildApp() stays untouched and a route added anywhere (feature module or core) is seen. A test file installs it:
//   vi.mock('fastify', async (original) => (await import('<rel>/route-registry.js')).collecting(await original()))
import type * as Fastify from 'fastify'

type FastifyModule = typeof Fastify
type Factory = FastifyModule['default']

const registered = new WeakMap<object, string[]>()

/** The fastify module with its factory wrapped: every instance records `METHOD /url` of each route it registers. */
export function collecting(original: FastifyModule): FastifyModule {
  const create = ((options?: Parameters<Factory>[0]) => {
    const app = original.default(options)
    const routes: string[] = []
    registered.set(app, routes)
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) routes.push(`${method} ${route.url}`)
    })
    return app
  }) as unknown as Factory
  return { ...original, default: create, fastify: create }
}

/** `METHOD /url` of every route the app registered, sorted. */
export function routesOf(app: object): readonly string[] {
  const routes = registered.get(app)
  if (routes === undefined) throw new Error('the app was not created through collecting(): install the vi.mock first')
  return [...new Set(routes)].sort()
}

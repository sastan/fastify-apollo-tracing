/**
 * @jest-environment node
 */
import fastify from 'fastify'
import mercurius from 'mercurius'

const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
`

const resolvers = {
  Query: {
    // @ts-ignore
    add: async (_, { x, y }, { trace }, info) => {
      return trace.trackFieldResolver(info, () => x + y)
    },
  },
}

function build(options?: import('../src').ApolloTracingOptions) {
  const app = fastify({
    logger: {
      level: 'warn',
      prettyPrint: true,
    },
  })

  app.register(mercurius, {
    schema,
    resolvers,
  })

  app.register(import('../src'), options)

  app.get('/', async function(_request, reply) {
    const query = '{ add(x: 2, y: 2) }'

    return reply.graphql(query)
  })

  return app
}

test('adds tracing', async () => {
  const app = build()

  const response = await app.inject({
    method: 'GET',
    url: '/',
  })

  const body = response.json()

  expect(body).toHaveProperty('data.add', 4)
  expect(body).toHaveProperty('extensions.tracing.version', 1)
})

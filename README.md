# fastify-apollo-tracing

> [Apollo Tracing](https://github.com/apollographql/apollo-tracing) for [fastify](https://fastify.io).

This package is used to collect and expose trace data in the [Apollo Tracing](https://github.com/apollographql/apollo-tracing) format.

It relies on instrumenting a GraphQL schema to collect resolver timings, and exposes trace data for an individual request under `extensions` as part of the GraphQL response.

This data can be consumed by [Apollo Studio](https://www.apollographql.com/docs/studio/) (previously, Apollo Engine and Apollo Graph Manager) or any other tool to provide visualization and history of field-by-field execution performance.

> This code is based on [apollo-tracing](https://github.com/apollographql/apollo-server/tree/main/packages/apollo-tracing).

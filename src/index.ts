import {
  ResponsePath,
  GraphQLType,
  ExecutionResult,
  GraphQLResolveInfo,
  responsePathAsArray,
} from 'graphql'

import { FastifyInstance } from 'fastify'

import fp from 'fastify-plugin'
import pFinally from 'p-finally'

import * as is from '@carv/is'
import { noop, never } from '@carv/stdlib'
import { hrtime, hrtimeToNanos } from '@carv/time'

export default fp(apolloTracingPlugin, {
  name: 'apollo-tracing',
  fastify: '3.x',
  decorators: { fastify: ['graphql'] },
})

export interface ExecutionInfo {
  source: string
  context?: any
  variables?: Record<string, any>
  operationName?: string
}

export interface ApolloTracingOptions {
  skip?: (execution: ExecutionInfo) => unknown
  executionWillStart?: (execution: ExecutionInfo & { trace: Trace }) => void | PromiseLike<void>
  executionDidEnd?: (
    execution: ExecutionInfo & { trace: Trace; result: ExecutionResult },
  ) => void | PromiseLike<void>
}

export interface TracingFormat {
  version: 1
  startTime: string
  endTime: string
  duration: number
  execution: {
    resolvers: {
      path: (string | number)[]
      parentType: string
      fieldName: string
      returnType: string
      startOffset: number
      duration: number
    }[]
  }
}

export interface ResolverCall {
  path: ResponsePath
  fieldName: string
  parentType: GraphQLType
  returnType: GraphQLType
  startOffset: HighResolutionTime
  endOffset?: HighResolutionTime
}

export type HighResolutionTime = [number, number]

const kResolverCalls = Symbol('kResolverCalls')

class Trace {
  readonly startWallTime: Date
  readonly startHrTime: HighResolutionTime;
  readonly [kResolverCalls]: ResolverCall[]

  constructor() {
    this.startWallTime = new Date()
    this.startHrTime = hrtime()
    this[kResolverCalls] = []
  }

  get offset(): HighResolutionTime {
    return hrtime(this.startHrTime)
  }

  trackFieldResolver<T>(info: GraphQLResolveInfo, resolve: () => T): T
  trackFieldResolver<T>(info: GraphQLResolveInfo, resolve: () => PromiseLike<T>): Promise<T>
  trackFieldResolver(info: GraphQLResolveInfo): () => void
  trackFieldResolver(info: GraphQLResolveInfo, resolve?: () => any) {
    const resolverCall: ResolverCall = {
      path: info.path,
      fieldName: info.fieldName,
      parentType: info.parentType,
      returnType: info.returnType,
      startOffset: this.offset,
      endOffset: undefined,
    }

    this[kResolverCalls].push(resolverCall)

    const done = () => {
      resolverCall.endOffset = this.offset
    }

    if (is.function(resolve)) {
      return track(resolve, done)
    }

    return done
  }
}

type GraphQLDecorator = (
  source: string,
  context?: any,
  variables?: Record<string, any>,
  operationName?: string,
) => Promise<ExecutionResult>

function apolloTracingPlugin(
  fastify: FastifyInstance,
  { executionWillStart = noop, executionDidEnd = noop, skip = never }: ApolloTracingOptions,
  done: (err?: Error) => void,
) {
  fastify.addHook('onReady', function(this: FastifyInstance & { graphql: GraphQLDecorator }, next) {
    const { graphql } = this

    this.graphql = async function(
      this: FastifyInstance,
      source,
      context,
      variables,
      operationName,
    ) {
      if (skip({ source, context, variables, operationName })) {
        return graphql.call(this, source, context, variables, operationName)
      }

      const trace = new Trace()

      context = { ...context, trace }

      const info = { trace, source, context, variables, operationName }

      await executionWillStart(info)

      const result = await graphql.call(this, source, context, variables, operationName)

      await executionDidEnd({ ...info, result })

      const { reply = this } = context

      return finish(trace, result, reply.log)
    } as typeof graphql

    Object.setPrototypeOf(this.graphql, graphql)

    next()
  })

  done()
}

function track(resolve: () => any, done: () => void): any {
  try {
    const result = resolve()

    if (is.promiseLike(result)) {
      return pFinally(result, done)
    }

    done()

    return result
  } catch (error) {
    done()
    throw error
  }
}

function finish(trace: Trace, result: ExecutionResult, log: FastifyInstance['log']) {
  // Based on https://github.com/apollographql/apollo-tracing
  const extensions = result.extensions || (result.extensions = Object.create(null))

  // Be defensive and make sure nothing else (other plugin, etc.) has
  // already used the `tracing` property on `extensions`.
  if (is.defined(extensions.tracing)) {
    const error = new Error(
      'Could not add `tracing` to `extensions` since `tracing` was unexpectedly already present.',
    )

    log.warn({ plugin: 'graphql', err: error, extensions }, error.message)

    return result
  }

  // Set the extensions.
  extensions.tracing = {
    version: 1,
    startTime: trace.startWallTime,
    endTime: new Date(),
    duration: hrtimeToNanos(trace.offset),
    // TODO get these from mercurius
    // "parsing": {
    //   "startOffset": 34953,
    //   "duration": 351736,
    // },
    // "validation": {
    //   "startOffset": 412349,
    //   "duration": 670107,
    // },
    execution: {
      resolvers: trace[kResolverCalls].map(formatResolverCall),
    },
  }

  return result
}

function formatResolverCall(resolverCall: ResolverCall) {
  const startOffset = hrtimeToNanos(resolverCall.startOffset)

  const duration = resolverCall.endOffset ? hrtimeToNanos(resolverCall.endOffset) - startOffset : 0

  return {
    path: [...responsePathAsArray(resolverCall.path)],
    parentType: resolverCall.parentType.toString(),
    fieldName: resolverCall.fieldName,
    returnType: resolverCall.returnType.toString(),
    startOffset,
    duration,
  }
}

import type { Hooks } from '@opencode-ai/plugin'

const OTEL_ENDPOINT = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

// Lazy-init SDK — only loaded when the endpoint is configured.
let tracer: { startSpan(name: string): ActiveSpan } | null = null

type ActiveSpan = {
  setAttributes(attrs: Record<string, string>): void
  end(): void
}

async function getTracer(): Promise<typeof tracer> {
  if (!OTEL_ENDPOINT) return null
  if (tracer) return tracer

  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')
  const { Resource } = await import('@opentelemetry/resources')
  const { SEMRESATTRS_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions')
  const api = await import('@opentelemetry/api')

  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: `yeap-bot-${BOT_NAME.toLowerCase()}`,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT}/v1/traces`,
    }),
  })
  sdk.start()

  const rawTracer = api.trace.getTracer('yeap-plugin')
  tracer = {
    startSpan(name: string): ActiveSpan {
      return rawTracer.startSpan(name)
    },
  }
  return tracer
}

// Track active spans keyed by callID
const activeSpans = new Map<string, ActiveSpan>()

export function createOtelHooks(): Partial<Hooks> {
  return {
    'tool.execute.before': async (input) => {
      const t = await getTracer()
      if (!t) return
      const span = t.startSpan(`yeap.tool.${input.tool}`)
      span.setAttributes({
        'yeap.bot.name': BOT_NAME,
        'yeap.tool.name': input.tool,
        'yeap.session.id': input.sessionID,
      })
      activeSpans.set(input.callID, span)
    },
    'tool.execute.after': async (input) => {
      const span = activeSpans.get(input.callID)
      if (span) {
        span.end()
        activeSpans.delete(input.callID)
      }
    },
  }
}

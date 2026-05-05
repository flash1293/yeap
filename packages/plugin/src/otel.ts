import type { Hooks } from '@opencode-ai/plugin'

const OTEL_ENDPOINT = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
const OTEL_HEADERS_RAW = process.env['OTEL_EXPORTER_OTLP_HEADERS'] ?? ''
const BOT_NAME = process.env['BOT_NAME'] ?? 'UnknownBot'

function parseOtelHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return headers
}

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
      headers: parseOtelHeaders(OTEL_HEADERS_RAW),
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

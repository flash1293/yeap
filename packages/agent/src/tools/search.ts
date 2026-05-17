import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const TAVILY_API_KEY = process.env['TAVILY_API_KEY'] ?? ''
const TAVILY_URL = 'https://api.tavily.com/search'

type TavilyResult = {
  title: string
  url: string
  content: string
  score: number
}

type TavilyResponse = {
  query: string
  answer?: string
  results: TavilyResult[]
}

const webSearchParams = Type.Object({
  query: Type.String({ description: 'The search query' }),
  max_results: Type.Optional(
    Type.Number({ description: 'Maximum results to return (default 5, max 10)', minimum: 1, maximum: 10 }),
  ),
  topic: Type.Optional(
    Type.Union([Type.Literal('general'), Type.Literal('news'), Type.Literal('finance')], {
      description: 'Search topic: general, news, or finance (default: general)',
    }),
  ),
})

export const web_search: AgentTool<typeof webSearchParams> = {
  name: 'web_search',
  label: 'Web Search',
  description:
    'Search the web using Tavily. Returns a list of relevant results with titles, URLs, and content snippets. ' +
    'Use this to look up current information, research topics, find documentation, or verify facts. ' +
    'Requires TAVILY_API_KEY to be set.',
  parameters: webSearchParams,
  execute: async (_id, params) => {
    if (!TAVILY_API_KEY) {
      return {
        content: [{ type: 'text' as const, text: 'Web search is not available: TAVILY_API_KEY is not configured.' }],
        details: {},
      }
    }

    let data: TavilyResponse
    try {
      const res = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
          query: params.query,
          max_results: params.max_results ?? 5,
          topic: params.topic ?? 'general',
          include_answer: true,
          search_depth: 'basic',
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        return {
          content: [{ type: 'text' as const, text: `Search failed (${res.status}): ${text}` }],
          details: {},
        }
      }

      data = (await res.json()) as TavilyResponse
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Search request failed: ${String(err)}` }],
        details: {},
      }
    }

    const lines: string[] = []

    if (data.answer) {
      lines.push(`**Summary:** ${data.answer}`, '')
    }

    lines.push(`**Results for:** ${data.query}`, '')

    for (const r of data.results) {
      lines.push(`### ${r.title}`, `URL: ${r.url}`, r.content, '')
    }

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
      details: { result_count: data.results.length },
    }
  },
}

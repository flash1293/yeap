import { Hono } from 'hono'
import { getBotByName } from '../db/helpers.js'

export const botProxyRouter = new Hono()

// ALL /bots/:name/proxy/* — transparent proxy to the bot's opencode server
botProxyRouter.all('/:name/proxy/*', async (c) => {
  const name = c.req.param('name')
  const bot = getBotByName(name)

  if (!bot?.opencode_url) {
    return c.json({ error: `Bot "${name}" not found or has no opencode_url` }, 404)
  }

  // Strip the /bots/:name/proxy prefix to get the target path
  const fullPath = c.req.path
  const prefixEnd = fullPath.indexOf('/proxy/') + '/proxy'.length
  const targetPath = fullPath.slice(prefixEnd) || '/'

  const queryString = new URL(c.req.url).search
  const targetUrl = `${bot.opencode_url}${targetPath}${queryString}`

  const method = c.req.method
  const hasBody = method !== 'GET' && method !== 'HEAD'

  // Forward relevant headers but strip hop-by-hop headers
  const forwardHeaders = new Headers()
  for (const [key, value] of c.req.raw.headers.entries()) {
    const lower = key.toLowerCase()
    if (
      lower === 'host' ||
      lower === 'connection' ||
      lower === 'upgrade' ||
      lower === 'proxy-connection' ||
      lower === 'transfer-encoding'
    ) continue
    forwardHeaders.set(key, value)
  }

  const fetchInit: RequestInit = {
    method,
    headers: forwardHeaders,
    ...(hasBody ? { body: c.req.raw.body } : {}),
  }

  const upstream = await fetch(targetUrl, fetchInit)

  // Rewrite absolute URLs in HTML/JS responses so assets load through the proxy
  const contentType = upstream.headers.get('content-type') ?? ''
  const isText = contentType.includes('text/') || contentType.includes('javascript') || contentType.includes('json')

  const responseHeaders = new Headers()
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase()
    // Strip hop-by-hop and CSP headers (CSP would block the injected interceptor script)
    if (lower === 'transfer-encoding' || lower === 'connection' || lower === 'content-security-policy') continue
    responseHeaders.set(key, value)
  }

  if (isText) {
    const text = await upstream.text()
    const proxyBase = `/bots/${encodeURIComponent(name)}/proxy`

    let rewritten = text
      .replace(/(href|src|action)="\//g, `$1="${proxyBase}/`)
      .replace(/from "\//g, `from "${proxyBase}/`)
      .replace(/url\(\//g, `url(${proxyBase}/`)

    // For HTML responses, inject an interceptor so opencode's JS API calls
    // (fetch, XHR, EventSource) are routed through the proxy instead of hitting
    // the YEAP PWA routes directly.
    if (contentType.includes('text/html')) {
      const interceptor = `<script>
(function(){
  var base=${JSON.stringify(proxyBase)};
  function rewrite(u){return(typeof u==="string"&&u.startsWith("/")&&!u.startsWith(base))?base+u:u;}
  var oF=window.fetch;
  window.fetch=function(u,i){return oF.call(this,rewrite(u),i);};
  var oX=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){return oX.apply(this,[m,rewrite(u)].concat([].slice.call(arguments,2)));};
  var oE=window.EventSource;
  window.EventSource=function(u,i){return new oE(rewrite(u),i);};
  window.EventSource.prototype=oE.prototype;
})();
</script>`
      rewritten = rewritten.replace('<head>', '<head>' + interceptor)
    }

    return new Response(rewritten, { status: upstream.status, headers: responseHeaders })
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
})

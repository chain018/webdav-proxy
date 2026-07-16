const ALLOWED = ['https://dav.jianguoyun.com/dav']

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS,PROPFIND,PROPPATCH,MKCOL,COPY,MOVE,LOCK,UNLOCK,SEARCH,REPORT',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400'
  }
}

function json(status, text) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain', ...corsHeaders() } })
}

async function handler(req) {
  const url = new URL(req.url)

  if (url.pathname === '/api/proxy/__diag' || url.pathname === '/__diag') {
    const target = 'https://dav.jianguoyun.com/dav/'
    const auth = url.searchParams.get('auth') || ''
    const headers = { 'User-Agent': 'Mozilla/5.0 todo-tool-diag/1.0' }
    if (auth) headers['Authorization'] = auth
    try {
      const r = await fetch(target, { method: 'GET', headers, redirect: 'manual' })
      const out = {
        target, platform: 'vercel', status: r.status,
        respHeaders: Object.fromEntries(r.headers.entries()),
        body: (await r.text()).slice(0, 1500)
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() }
      })
    } catch (e) {
      return json(502, 'Diag fetch failed: ' + (e?.message || String(e)))
    }
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const targetBase = req.headers.get('X-Target-Base')
  if (!targetBase) return json(400, 'Missing X-Target-Base header')
  const target = targetBase.replace(/\/+$/, '')

  if (ALLOWED.length && !ALLOWED.some((a) => target.startsWith(a))) {
    return json(403, 'Target not allowed')
  }

  const subPath = url.pathname.replace(/^\/api\/proxy/, '') || '/'
  const targetUrl = target + subPath + url.search

  const keep = new Set(['authorization','content-type','depth','overwrite','destination','if','if-match','if-none-match','lock-token','timeout'])
  const headers = new Headers()
  for (const [k, v] of req.headers.entries()) {
    if (keep.has(k.toLowerCase())) headers.set(k, v)
  }
  headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) todo-tool/1.0')

  const init = { method: req.method, headers, redirect: 'follow' }
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = await req.arrayBuffer()
  }

  let resp
  try {
    resp = await fetch(targetUrl, init)
  } catch (e) {
    return json(502, 'Upstream fetch failed: ' + (e?.message || String(e)))
  }

  if (resp.status >= 500) {
    const bodySnippet = (await resp.text()).slice(0, 500)
    return json(resp.status, `Upstream ${resp.status} from ${target}\n--- body ---\n${bodySnippet}`)
  }

  const respHeaders = new Headers(resp.headers)
  for (const [k, v] of Object.entries(corsHeaders())) {
    respHeaders.set(k, v)
  }
  return new Response(resp.body, { status: resp.status, headers: respHeaders })
}

module.exports = handler
module.exports.default = handler

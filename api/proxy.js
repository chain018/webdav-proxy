const ALLOWED = ['https://dav.jianguoyun.com/dav']

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS,PROPFIND,PROPPATCH,MKCOL,COPY,MOVE,LOCK,UNLOCK,SEARCH,REPORT',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400'
}

const KEEP_HEADERS = new Set(['authorization','content-type','depth','overwrite','destination','if','if-match','if-none-match','lock-token','timeout'])

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function applyCors(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
}

module.exports = async function handler(req, res) {
  try {
    const url = req.url || '/'

    if (url === '/api/proxy/__diag' || url === '/__diag') {
      const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
      const auth = u.searchParams.get('auth') || ''
      const headers = { 'User-Agent': 'Mozilla/5.0 todo-tool-diag/1.0' }
      if (auth) headers['Authorization'] = auth
      try {
        const r = await fetch('https://dav.jianguoyun.com/dav/', { method: 'GET', headers, redirect: 'manual' })
        const body = await r.text()
        const out = {
          platform: 'vercel', target: 'https://dav.jianguoyun.com/dav/', status: r.status,
          respHeaders: Object.fromEntries(r.headers.entries()),
          body: body.slice(0, 1500)
        }
        applyCors(res)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.status(200).send(JSON.stringify(out, null, 2))
      } catch (e) {
        applyCors(res)
        return res.status(502).send('Diag fetch failed: ' + (e?.message || String(e)))
      }
    }

    if (req.method === 'OPTIONS') {
      applyCors(res)
      return res.status(204).send('')
    }

    const targetBase = req.headers['x-target-base']
    if (!targetBase) {
      applyCors(res)
      return res.status(400).send('Missing X-Target-Base header')
    }
    const target = String(targetBase).replace(/\/+$/, '')

    if (ALLOWED.length && !ALLOWED.some((a) => target.startsWith(a))) {
      applyCors(res)
      return res.status(403).send('Target not allowed')
    }

    const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
    const subPath = u.pathname.replace(/^\/api\/proxy/, '') || '/'
    const targetUrl = target + subPath + u.search

    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (KEEP_HEADERS.has(k.toLowerCase())) headers[k] = v
    }
    headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) todo-tool/1.0'

    let bodyBuf
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      bodyBuf = await readBody(req)
    }

    const init = { method: req.method, headers, redirect: 'follow' }
    if (bodyBuf) init.body = bodyBuf

    let upstream
    try {
      upstream = await fetch(targetUrl, init)
    } catch (e) {
      applyCors(res)
      return res.status(502).send('Upstream fetch failed: ' + (e?.message || String(e)))
    }

    if (upstream.status >= 500) {
      const snippet = (await upstream.text()).slice(0, 500)
      applyCors(res)
      return res.status(upstream.status).send('Upstream ' + upstream.status + ' from ' + target + '\n--- body ---\n' + snippet)
    }

    upstream.headers.forEach((v, k) => {
      const kl = k.toLowerCase()
      if (kl === 'content-encoding' || kl === 'content-length' || kl === 'transfer-encoding') return
      res.setHeader(k, v)
    })
    applyCors(res)

    const buf = Buffer.from(await upstream.arrayBuffer())
    return res.status(upstream.status).send(buf)
  } catch (e) {
    applyCors(res)
    return res.status(500).send('Proxy error: ' + (e?.message || String(e)) + '\n' + (e?.stack || ''))
  }
}

export const BASE_URL = "https://thehub.io"
export const USER_AGENT = "Mozilla/5.0 (compatible; thehub-cli/1.0)"
export type Format = "json" | "table" | "plain"
export type RecordData = Record<string, unknown>

export class CLIError extends Error {
  constructor(message: string, public code = "BAD_RESPONSE") { super(message) }
}
export function writeError(error: unknown): void {
  process.stderr.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof CLIError ? error.code : "REQUEST_FAILED",
  }) + "\n")
}
export function object(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordData : {}
}
export function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null
}
export function date(value: unknown): string | null {
  const raw = text(value)
  if (!raw || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) return null
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw.slice(0, 10)
    ? raw.slice(0, 10) : null
}
export function normalizeId(input: string): string | null {
  if (/^[a-f0-9]{24}$/i.test(input)) return input.toLowerCase()
  try {
    const url = new URL(input.startsWith("thehub.io/") || input.startsWith("www.thehub.io/") ? `https://${input}` : input)
    if (!['https:', 'http:'].includes(url.protocol) || !['thehub.io', 'www.thehub.io'].includes(url.hostname) || url.username || url.password || url.port) return null
    return url.pathname.match(/^\/jobs\/([a-f0-9]{24})\/?$/i)?.[1].toLowerCase() ?? null
  } catch { return null }
}

export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : null
}
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
export type Getter = (path: string) => Promise<unknown | null>
export async function apiGet(path: string, deps: {
  fetch?: Fetcher; sleep?: (ms: number) => Promise<void>; random?: () => number
} = {}): Promise<unknown | null> {
  const get = deps.fetch ?? fetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let waited = 0
  for (let attempt = 0; attempt <= 6; attempt++) {
    const response = await get(`${BASE_URL}/api${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000), redirect: "error",
    })
    if (response.status === 404) return null
    if (response.status === 429 || response.status >= 500) {
      const wait = Math.max(Math.min(500 * 2 ** attempt, 8000) + Math.floor((deps.random ?? Math.random)() * 500), retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      await response.body?.cancel()
      if (attempt === 6 || waited + wait > 30_000) throw new CLIError(`The Hub returned HTTP ${response.status}; retry budget exhausted. Try later.`, "RATE_OR_SERVER_ERROR")
      await sleep(wait); waited += wait
      continue
    }
    if (!response.ok) throw new CLIError(`The Hub returned HTTP ${response.status}`, "HTTP_ERROR")
    try { return await response.json() }
    catch { throw new CLIError("The Hub returned invalid JSON", "BAD_RESPONSE") }
  }
  throw new CLIError("The Hub request failed")
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
  aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", aring: "å", Aring: "Å",
}
export function cleanHtml(value: unknown): string | null {
  const html = text(value)
  if (!html) return null
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|h[1-6]|li|ul|ol)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ").replace(/<[^>]*>/g, "")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, key: string) => {
      if (!key.startsWith("#")) return ENTITIES[key] ?? whole
      const cp = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1))
      return cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ""
    }).replace(/[ \t\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null
}

const POSITION_TYPES: Record<string, string> = {
  '5b8e46b3853f039706b6ea73': 'Internship', '62e28180d8cca695ee60c98e': 'Advisory board',
  '5b8e46b3853f039706b6ea72': 'Student', '5b8e46b3853f039706b6ea74': 'Cofounder',
  '5b8e46b3853f039706b6ea70': 'Full-time', '5b8e46b3853f039706b6ea71': 'Part-time',
  '5b8e46b3853f039706b6ea75': 'Freelance',
}
export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  dateSource: string | null
  url: string
  isRemote: boolean | null
  employmentTypes: string[]
}
export function toResult(value: unknown): JobResult | null {
  const job = object(value), id = text(job.id), title = cleanHtml(job.title)
  if (!id || !/^[a-f0-9]{24}$/i.test(id) || !title) return null
  const loc = object(job.location)
  const published = date(job.publishedAt), created = date(job.createdAt)
  return {
    id, title, company: cleanHtml(object(job.company).name),
    location: text(loc.address) ?? ([text(loc.locality), text(loc.country)].filter(Boolean).join(", ") || null),
    date: published ?? created, dateSource: published ? "publishedAt" : created ? "createdAt" : null,
    url: `${BASE_URL}/jobs/${id}`, isRemote: typeof job.isRemote === 'boolean' ? job.isRemote : null,
    employmentTypes: Array.isArray(job.jobPositionTypes) ? job.jobPositionTypes.filter((v): v is string => typeof v === 'string').map(v => POSITION_TYPES[v] ?? v) : [],
  }
}
export function toDetail(value: unknown, expectedId: string) {
  const result = toResult(value), job = object(value)
  if (!result || result.id !== expectedId) throw new CLIError("The Hub returned an invalid or mismatched job detail")
  const status = text(job.status)
  return {
    ...result, description: cleanHtml(job.description), status,
    isActive: status === 'ACTIVE' ? true : status ? false : null,
    deadline: date(job.expirationDate), salary: text(job.salary), equity: text(job.equity),
    applyUrl: safeWebUrl(job.link) ?? result.url,
  }
}
function safeWebUrl(value: unknown): string | null {
  try { const u = new URL(text(value) ?? ''); return ['https:', 'http:'].includes(u.protocol) ? u.href : null }
  catch { return null }
}
export function renderJobs(jobs: JobResult[], format: 'table' | 'plain'): string {
  if (!jobs.length) return "No results."
  if (format === 'plain') return jobs.map(j => `${j.title}\n${j.company ?? '—'} · ${j.location ?? (j.isRemote ? 'Remote' : '—')}\nDate: ${j.date ?? 'unknown'}\n${j.url}`).join('\n\n')
  return ['TITLE\tCOMPANY\tLOCATION\tDATE\tURL', ...jobs.map(j => [j.title, j.company ?? '—', j.location ?? (j.isRemote ? 'Remote' : '—'), j.date ?? 'unknown', j.url].map(v => v.replace(/[\t\n]/g, ' ')).join('\t'))].join('\n')
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The file resolver for the OFF-PLATFORM architecture jury: an external juror who
// will never hold an account scores through /sm26/jury/architecture?token=..., and
// a token is not a Supabase session, so the private 'event-media' bucket cannot be
// read from the browser.
//
// POST { token, entry_id }        -> { ok:true, files:[{ label, kind, is_image, idx }] }
// GET  ?token=&entry=&i=          -> the bytes of file `i` of that entry
//
// The token is the WHOLE gate — there is no session behind it — so every request
// re-validates: token exists, not revoked, and entry_id really is a live
// architecture entry OF THAT REVIEWER'S EVENT. Never trust entry_id to be one of
// the entries we handed out; it arrives from the client. Deployed with
// verify_jwt = false so a plain <img src>/<iframe src> can reach the GET, the same
// way sm26-register and claim-code-signup are public.
//
// ANONYMITY — the reason this streams bytes instead of returning signed URLs.
// The competition is judged blind. A Supabase signed URL embeds the storage path,
// and live paths carry the firm's name in plaintext (".../Cowan Architects_Digital
// Overview Portfolio compressed.pdf", ".../X-TU_AGENCY_07___L._Boegly.jpg"), so
// handing a juror a signed URL hands them the entrant's identity in the address
// bar. sm26-assets avoids this for logged-in jurors by refusing project_renders
// outright; that is not available here, because 10 of the 12 live entries never
// uploaded A2 panels and their project_renders ARE the submission. So the path
// never leaves this function: the juror's browser only ever sees an opaque index,
// and even the saved filename is the anonymous label ("Panel 3 (A2).pdf").

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const ALLOWED_ORIGINS = [
  "https://smartmarinaconnect.com", "https://m3connect.netlify.app", "https://m3connectv2.netlify.app",
  "http://localhost:5173", "http://localhost:3000",
];
const NETLIFY_SUBDOMAIN = /^https:\/\/[a-z0-9-]+--m3connect(v2)?\.netlify\.app$/;
const isAllowed = (o: string) => ALLOWED_ORIGINS.includes(o) || NETLIFY_SUBDOMAIN.test(o);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": isAllowed(req.headers.get("origin") || "") ? (req.headers.get("origin") as string) : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
});
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;
const DEAD_REG = ["declined", "cancelled"];

const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
const extOf = (p: string) => (p.split("?")[0].split(".").pop() || "").toLowerCase();
const mimeOf = (p: string) => MIME[extOf(p)] || "application/octet-stream";

interface ArchFile { kind: string; file_path: string; filename: string | null }
interface Item { path: string; label: string; kind: string }

// filename is read ONLY to order the panels and is never returned — it is the
// field that carries the architect's name.
const nameOf = (f: ArchFile) => f.filename || f.file_path.split("/").pop() || "file";

// Name each file the way the brief names it. Order panels by filename rather than
// by upload time: a re-uploaded panel would otherwise renumber every panel after
// it, and a juror's comments reference panel numbers. Same rule as the admin
// tracker and the on-platform jury page, so all three agree on "Panel 3".
function labelled(files: ArchFile[]): Item[] {
  const of = (k: string) => files.filter((f) => f.kind === k);
  const panels = of("panel").sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }));
  const known = ["panel", "notice", "animation"];
  return [
    ...panels.map((f, i) => ({ path: f.file_path, kind: "panel", label: `Panel ${i + 1} (A2)` })),
    ...of("notice").map((f) => ({ path: f.file_path, kind: "notice", label: "Descriptive notice (A3)" })),
    ...of("animation").map((f) => ({ path: f.file_path, kind: "animation", label: "3D animation" })),
    // A kind added later still reaches the juror, but under a neutral label —
    // falling back to the filename would break anonymity silently.
    ...files.filter((f) => !known.includes(f.kind)).map((f, i) => ({ path: f.file_path, kind: "other", label: `Additional document ${i + 1}` })),
  ];
}

type Admin = ReturnType<typeof createClient>;

// Token + entry validation and the item list, shared by both verbs so the index
// the GET receives always means the same file the POST described.
async function resolve(admin: Admin, token: string, entryId: string): Promise<{ error: string } | { items: Item[] }> {
  if (!token) return { error: "missing_token" };
  // Guard the uuid shape here — a malformed one makes Postgres raise 22P02 rather
  // than return no rows, which would surface as a server error, not "bad entry".
  if (!UUID.test(entryId)) return { error: "invalid_entry" };

  // 1. Token -> reviewer. Revoking a link must lock the files too, not only the
  //    scorecard, so this runs before anything is looked up or read.
  const { data: revRow } = await admin.from("sm_architecture_reviewer")
    .select("id, event_id, revoked_at").eq("token", token).maybeSingle();
  const reviewer = revRow as { id: string; event_id: string; revoked_at: string | null } | null;
  if (!reviewer) return { error: "invalid_token" };
  if (reviewer.revoked_at) return { error: "revoked" };

  // 2. entry_id must be a LIVE architecture entry of the reviewer's own event.
  //    Without the event check a token would read another event's files; without
  //    the role check it would read a startup's pitch deck.
  const { data: raRow } = await admin.from("sm_role_assignment")
    .select("id, role, status, event_id, registration_id").eq("id", entryId).maybeSingle();
  const ra = raRow as { role: string; status: string; event_id: string; registration_id: string } | null;
  if (!ra || ra.event_id !== reviewer.event_id || !ra.role.startsWith("architect") || ra.status === "declined")
    return { error: "invalid_entry" };

  // A withdrawn registration takes its entry out of the competition even when the
  // role row itself was never touched — mirror the live-entry set the rankings use.
  const { data: regRow } = await admin.from("sm_registration")
    .select("status").eq("id", ra.registration_id).maybeSingle();
  const reg = regRow as { status: string } | null;
  if (!reg || DEAD_REG.includes(reg.status)) return { error: "invalid_entry" };

  // 3. Both file sources. sm_architecture_file is the competition submission (8 A2
  //    panels + A3 notice); project_renders is what the imported entries carry
  //    instead, and for most of the field it is the only thing there is to score.
  const { data: fileRows } = await admin.from("sm_architecture_file")
    .select("kind, file_path, filename").eq("role_assignment_id", entryId);
  const { data: entryRow } = await admin.from("sm_architecture_entry")
    .select("project_renders").eq("role_assignment_id", entryId).maybeSingle();

  const items = labelled((fileRows || []) as ArchFile[]);

  const rawRenders: unknown[] = Array.isArray((entryRow as { project_renders?: unknown[] } | null)?.project_renders)
    ? ((entryRow as { project_renders: unknown[] }).project_renders) : [];
  const seen = new Set<string>(items.map((i) => i.path));
  rawRenders
    .filter((p): p is string => typeof p === "string" && !!p.trim())
    .map((p) => p.trim())
    // De-dupe BEFORE numbering, so "Project image 4" is the fourth thing the juror
    // actually sees rather than the fourth row in the column.
    .filter((p) => { if (seen.has(p)) return false; seen.add(p); return true; })
    .forEach((p, i) => items.push({ path: p, kind: "render", label: `Project image ${i + 1}` }));

  return { items };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  // ---- GET: the bytes themselves, addressed by opaque index ----
  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    const r = await resolve(admin, (q.get("token") || "").trim(), (q.get("entry") || "").trim());
    if ("error" in r) return json(req, { ok: false, error: r.error }, 403);
    const i = Number(q.get("i"));
    if (!Number.isInteger(i) || i < 0 || i >= r.items.length) return json(req, { ok: false, error: "invalid_file" }, 404);
    const item = r.items[i];

    const { data: blob, error } = await admin.storage.from("event-media").download(item.path);
    if (error || !blob) return json(req, { ok: false, error: "not_found" }, 404);

    return new Response(blob, {
      headers: {
        ...cors(req),
        "Content-Type": mimeOf(item.path),
        // The saved name is the anonymous label, never the stored filename.
        "Content-Disposition": `inline; filename="${item.label.replace(/["\\]/g, "")}.${extOf(item.path) || "bin"}"`,
        // Private: the token is the only credential, so no shared cache may keep it.
        "Cache-Control": "private, max-age=600",
      },
    });
  }

  if (req.method !== "POST") return json(req, { ok: false, error: "method_not_allowed" }, 405);

  // ---- POST: the manifest. No URLs, no paths — just labels and indexes ----
  let body: { token?: unknown; entry_id?: unknown };
  try { body = await req.json(); } catch { return json(req, { ok: false, error: "invalid_json" }, 400); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const entryId = typeof body.entry_id === "string" ? body.entry_id.trim() : "";
  // Every domain failure answers 200 with {ok:false,error}: functions.invoke()
  // swallows the body of a non-2xx, and the page needs the code to choose its
  // message. Same convention as the sm_*_by_token RPCs.
  const r = await resolve(admin, token, entryId);
  if ("error" in r) return json(req, { ok: false, error: r.error });

  // Built field by field: nothing from the row can ride along by accident.
  const files = r.items.map((it, idx) => ({
    label: it.label, kind: it.kind, is_image: IMG_EXT.test(it.path), idx,
  }));

  return json(req, { ok: true, files });
});

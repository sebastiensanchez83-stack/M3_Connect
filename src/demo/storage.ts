// Fake Supabase Storage. Fixture files are static assets under
// public/demo-assets/<bucket>/<path>; uploads made during a take go to
// IndexedDB. Every URL handed back points at /__demo/storage/v1/object/public/…,
// which the service worker (uploads) or a rewrite (fixtures) turns into a file.
import { putUpload, getUpload, deleteUpload, listUploadKeys } from './uploads';

const publicPath = (bucket: string, path: string) => `/object/public/${bucket}/${path}`;
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export async function handleStorage(method: string, rest: string, req: Request): Promise<{ status: number; body: any; raw?: Blob }> {
  const parts = rest.split('/').filter(Boolean).map(decode);

  if (parts[0] === 'bucket') return { status: 200, body: [] };
  if (parts[0] !== 'object') return { status: 200, body: {} };

  const [, kind, ...tail] = parts;

  // createSignedUrl(s)
  if (kind === 'sign') {
    const [bucket, ...p] = tail;
    const body = await req.clone().json().catch(() => ({}));
    if (p.length) return { status: 200, body: { signedURL: publicPath(bucket, p.join('/')) } };
    const paths: string[] = body.paths || [];
    return { status: 200, body: paths.map(path => ({ path, signedURL: publicPath(bucket, path), error: null })) };
  }

  if (kind === 'upload' && tail[0] === 'sign') {
    const [, bucket, ...p] = tail;
    if (method === 'POST') return { status: 200, body: { url: `/object/upload/sign/${bucket}/${p.join('/')}?token=demo` } };
    const blob = await req.blob();
    await putUpload(`${bucket}/${p.join('/')}`, blob);
    return { status: 200, body: { Key: `${bucket}/${p.join('/')}` } };
  }

  if (kind === 'list') {
    const [bucket] = tail;
    const body = await req.clone().json().catch(() => ({}));
    const prefix = (body.prefix || '').replace(/\/$/, '');
    const keys = (await listUploadKeys()).map(String).filter(k => k.startsWith(`${bucket}/${prefix}`));
    return {
      status: 200,
      body: keys.map(k => ({ name: k.slice(bucket.length + 1 + (prefix ? prefix.length + 1 : 0)), id: k, created_at: new Date().toISOString(), metadata: { size: 0, mimetype: 'application/octet-stream' } })),
    };
  }

  if (kind === 'move' || kind === 'copy') return { status: 200, body: { message: 'ok' } };

  // download: GET /object/<public|authenticated>/<bucket>/<path> or /object/<bucket>/<path>
  if (method === 'GET') {
    const scoped = kind === 'public' || kind === 'authenticated';
    const [bucket, ...p] = scoped ? tail : [kind, ...tail];
    const key = `${bucket}/${p.join('/')}`;
    const blob = (await getUpload(key)) || (await fetch(`/demo-assets/${key}`).then(r => (r.ok ? r.blob() : undefined)).catch(() => undefined));
    return blob ? { status: 200, body: null, raw: blob } : { status: 404, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } };
  }

  // remove: DELETE /object/<bucket> { prefixes }
  if (method === 'DELETE') {
    const bucket = kind;
    const body = await req.clone().json().catch(() => ({}));
    for (const p of body.prefixes || []) await deleteUpload(`${bucket}/${p}`);
    return { status: 200, body: (body.prefixes || []).map((name: string) => ({ name })) };
  }

  // upload/update: POST|PUT /object/<bucket>/<path>
  const bucket = kind;
  const path = tail.join('/');
  const ct = req.headers.get('content-type') || '';
  let blob: Blob;
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const file = [...fd.values()].find(v => v instanceof Blob) as Blob | undefined;
    blob = file || new Blob();
  } else {
    blob = await req.blob();
  }
  await putUpload(`${bucket}/${path}`, blob);
  return { status: 200, body: { Key: `${bucket}/${path}`, Id: `${bucket}/${path}` } };
}

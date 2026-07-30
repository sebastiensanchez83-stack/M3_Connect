import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { RefreshCw, ArrowLeft, QrCode, Search, Check, Download, UserCheck, X, Camera, Undo2, Users, Vibrate, Volume2, VolumeX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { SM26_ROLE_LABELS } from './AdminSM26';

// Admin check-in console (Area 7). Check-in is per ATTENDEE — a registration
// (a company) can bring several named people, each with their own badge QR.
// The emitted entry QR encodes /admin/sm26/checkin?token=… — a staff phone
// scanning it lands here and checks that attendee in for the active window.
// Manual name-lookup is the fallback. Export feeds external badge printing.

interface Win { key: string; label: string; sort: number; }
interface RegRef { id: string; company_name: string | null; status: string; roles: { role: string; status?: string }[] }
interface Attendee {
  id: string;                          // sm_attendee id
  first_name: string | null; last_name: string | null; email: string | null;
  is_primary: boolean; attending: boolean;
  registration: RegRef | RegRef[] | null;
  badge?: { checkin_token: string } | { checkin_token: string }[];
  checkins: { window_key: string }[];
}
interface ScanResult { ok: boolean; error?: string; name?: string; company?: string | null; roles?: string[]; already?: boolean; attendee_id?: string; can_force?: boolean; forced?: boolean; }

const tokenOf = (a: Attendee) => (Array.isArray(a.badge) ? a.badge[0]?.checkin_token : a.badge?.checkin_token) || '';
const regOf = (a: Attendee): RegRef | null => (Array.isArray(a.registration) ? a.registration[0] : a.registration) || null;
const nameOf = (a: Attendee) => `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || 'This attendee';

// Why the door refuses someone, in words the welcome desk can act on.
const BLOCK_LABEL: Record<string, string> = {
  registration_cancelled: 'Registration withdrawn',
  registration_declined: 'Registration refused',
  registration_under_review: 'Registration not confirmed yet',
  registration_submitted: 'Registration not confirmed yet',
  payment_missing: 'No payment recorded',
  payment_invoiced: 'Invoice not settled',
  payment_unpaid: 'Payment outstanding',
  not_attending: 'Marked as not attending',
  jury_not_onsite: 'Juror has not confirmed attending on site',
  not_found: 'No attendee behind this badge',
  unknown_token: 'Unknown or invalid QR code',
  force_reason_required: 'A reason is required to admit anyway',
};
const rolesOf = (a: Attendee) => regOf(a)?.roles || [];
const companyOf = (a: Attendee) => regOf(a)?.company_name || '';

// A badge QR encodes the check-in URL (…/checkin?token=XYZ). Pull the token out
// whether we scanned a full URL or a bare token.
const parseToken = (raw: string) => { try { return new URL(raw).searchParams.get('token') || raw; } catch { return raw.trim(); } };

// Feedback at the door, silently. Whoever is scanning is looking at the badge and
// at the person, not at the screen, so each scan announces itself in the hand.
// Four distinct patterns, because "the code was read" and "this person may come
// in" are different facts and the second is the one that decides anything.
// Deliberately no sound: the desk sits next to the sessions.
//
// Two mechanisms, because there is no single one that covers both phones:
//
//  - Android (Chrome, Firefox, Samsung): navigator.vibrate, a real API, exact
//    millisecond patterns.
//  - iPhone: iOS implements NO vibration API — navigator.vibrate is undefined in
//    Safari and in every iOS browser, since they are all WebKit. The only lever a
//    web page has on the Taptic Engine is Safari 17.4's native switch control,
//    which plays a system haptic when it flips. Flipping one off-screen is a
//    side effect of a UI control rather than an API: it needs iOS 17.4 or later,
//    it gives one fixed tap rather than a pattern, and Apple can take it away.
//    Hence the "Test vibration" button — one tap tells you whether this phone
//    can do it at all, instead of finding out at the door.
type DoorSignal = 'read' | 'admitted' | 'already' | 'refused';
const BUZZ: Record<DoorSignal, number[]> = {
  read: [25],                      // decoded — you can move the badge away
  admitted: [50],                  // let them in
  already: [30, 80, 30],           // seen before in this window; not a fault
  refused: [70, 60, 70, 60, 120],  // unmistakably different from the other three
};
// How many taps stand in for each pattern where only a fixed tap is available.
const TAPS: Record<DoorSignal, number> = { read: 1, admitted: 1, already: 2, refused: 3 };

let hapticSwitch: { input: HTMLInputElement; label: HTMLLabelElement } | null = null;
let hapticSwitchTried = false;
// Safari 17.4+ reflects the switch attribute as a property; anything else fails
// this test and gets nothing, which is the honest outcome.
function iosHaptic(): { input: HTMLInputElement; label: HTMLLabelElement } | null {
  if (hapticSwitchTried) return hapticSwitch;
  hapticSwitchTried = true;
  try {
    const probe = document.createElement('input');
    probe.type = 'checkbox';
    if (!('switch' in probe)) return null;
    probe.setAttribute('switch', '');
    probe.id = 'sm26-haptic';
    probe.tabIndex = -1;
    probe.setAttribute('aria-hidden', 'true');
    // It has to be laid out and hit-testable for the control to run its state
    // change, so it is parked off-screen rather than display:none'd.
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    const label = document.createElement('label');
    label.htmlFor = 'sm26-haptic';
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(probe);
    document.body.appendChild(label);
    hapticSwitch = { input: probe, label };
  } catch { hapticSwitch = null; }
  return hapticSwitch;
}

// Sound, because on an iPhone neither of the above may fire and something has to
// reach a person who is not looking at the screen. Silenceable and remembered:
// the welcome desk sits next to the sessions, and a beeping phone during a
// keynote is worse than no feedback at all.
const SOUND_KEY = 'sm26.checkin.sound';
let soundOn = (() => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } })();
const isSoundOn = () => soundOn;
const setSoundPref = (on: boolean) => { soundOn = on; try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };

let audioCtx: AudioContext | null = null;
// Must be called from inside a tap: iOS starts every AudioContext suspended and
// only a user gesture may resume it. Opening the scanner is that tap.
function primeAudio() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioCtx && Ctor) audioCtx = new Ctor();
    if (audioCtx?.state === 'suspended') void audioCtx.resume();
  } catch { audioCtx = null; }
}

const TONES: Record<DoorSignal, { freqs: number[]; ms: number }> = {
  read: { freqs: [1400], ms: 45 },              // a tick: the code is in
  admitted: { freqs: [784, 1175], ms: 90 },     // rising — good news
  already: { freqs: [1047, 1047], ms: 85 },     // flat repeat — seen before
  refused: { freqs: [415, 311, 233], ms: 150 }, // falling — stop
};
function tone(kind: DoorSignal) {
  if (!soundOn) return;
  primeAudio();
  const ctx = audioCtx;
  if (!ctx || ctx.state !== 'running') return;
  const { freqs, ms } = TONES[kind];
  const step = ms / 1000;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    const t0 = ctx.currentTime + i * step;
    osc.type = 'sine'; osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(kind === 'read' ? 0.12 : 0.32, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + step + 0.02);
  });
}

// Returns how the buzz was delivered, so the test button can say something true.
function doorSignal(kind: DoorSignal): 'vibrate' | 'ios-switch' | 'none' {
  tone(kind);
  try {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(BUZZ[kind])) return 'vibrate';
  } catch { /* fall through */ }
  const h = iosHaptic();
  if (h) {
    for (let i = 0; i < TAPS[kind]; i++) setTimeout(() => { try { h.label.click(); } catch { /* gone */ } }, i * 140);
    return 'ios-switch';
  }
  return 'none';
}

// Read one frame (or a crop of it) through jsQR. Both framings are kept because
// each wins somewhere, measured by replaying real entry-pass PNGs through a
// synthetic video stream: with the code filling a tenth of the frame — a badge
// held out, not pressed against the lens — the centre square reads it and the
// squashed full frame does not; a little closer and slightly blurred, the full
// frame reads it and the crop does not. Alternating gets both, at ~60ms each.
// The 960 cap is the floor that keeps the centre crop at native resolution;
// going lower would throw away the pixels we just asked the camera for.
const WORK_PX = 960;
function readFrame(
  ctx: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  mode: 'centre' | 'full',
): string {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return '';
  const side = Math.min(vw, vh);
  const sw = mode === 'centre' ? Math.round(side * 0.75) : vw;
  const sh = mode === 'centre' ? Math.round(side * 0.75) : vh;
  const sx = Math.round((vw - sw) / 2), sy = Math.round((vh - sh) / 2);
  const scale = Math.min(1, WORK_PX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const c = ctx.canvas;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
  // attemptBoth also catches a code shown light-on-dark (a phone in dark mode).
  const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
  return code?.data || '';
}

// Live camera QR scanner that works on ANY browser.
//
// This used to accept whatever resolution the camera offered, which is 640×480
// on most browsers when nobody asks. Replaying real entry passes through a
// synthetic stream: at 640×480 the code had to fill 30% of the frame to decode
// at all, while at 1080p it decodes down to 10% — the badge can be held three
// times further away. That gap is why a phone's own camera app read a pass the
// door scanner could not, and asking for resolution is the substance of the fix.
//
// The native BarcodeDetector is used where the platform genuinely supports it
// (Android, macOS — it is absent on Windows, checked, so jsQR does the work
// there). It is now probed via getSupportedFormats and demoted permanently on
// its first failure: previously any rejection from detect() was swallowed by the
// loop's catch and jsQR was never reached, leaving a scanner that looked alive
// and read nothing. The camera is opened FIRST, before any await, because iOS
// Safari only grants getUserMedia within the user-gesture window. Debounce keeps
// the scanner open for back-to-back scans. If the live read still fails (dim
// light, glare on a screen), "Take a photo" decodes a full-resolution still.
function QrScanner({ onToken, onClose, paused }: { onToken: (token: string) => void; onClose: () => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [diag, setDiag] = useState('');
  const [stalled, setStalled] = useState(false);
  // Keep the latest handler so the long-running scan loop never goes stale.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  // While a verdict is on screen the camera keeps running but stops decoding —
  // otherwise the badge still in frame re-reads itself behind the overlay.
  const pausedRef = useRef(!!paused);
  pausedRef.current = !!paused;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0; let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      // Open the camera first, while still inside the user-gesture window.
      // A low-resolution stream is the single most common reason a QR will not
      // decode, so ask for 1080p and let the browser give what it can.
      const wanted: MediaTrackConstraints = {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 }, height: { ideal: 1080 },
      };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: wanted });
      } catch {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); } catch {
          setErr('Camera access was blocked. Allow camera permission in your browser settings — or use "Take a photo", or the name search below.');
          return;
        }
      }
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      const track = stream.getVideoTracks()[0];
      // Continuous autofocus where the platform supports it; ignored elsewhere.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await track?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any); } catch { /* not supported */ }
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try { await v.play(); } catch { /* autoplay attribute covers this */ }
      }
      setStarting(false);

      // Native detector, probed properly: the constructor existing proves
      // nothing, only the platform reporting qr_code support does — and even
      // then a first failure demotes us to jsQR for the rest of the session.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let native: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const BD = (window as any).BarcodeDetector;
        if (BD?.getSupportedFormats) {
          const formats: string[] = await BD.getSupportedFormats();
          if (formats.includes('qr_code')) native = new BD({ formats: ['qr_code'] });
        }
      } catch { native = null; }
      const s = track?.getSettings?.();
      setDiag(`${s?.width || '?'}×${s?.height || '?'} · ${native ? 'fast' : 'standard'}`);

      // Debounce so a badge sitting in frame isn't re-read; throttle to spare CPU.
      let lastVal = ''; let lastTime = 0; let lastScan = 0; let flip = 0;
      const started = performance.now();
      const tick = async () => {
        if (stopped) return;
        const now = performance.now();
        if (!pausedRef.current && now - lastScan > 120) {
          lastScan = now;
          const vid = videoRef.current;
          // HAVE_CURRENT_DATA — reading before this yields a blank canvas.
          if (vid && vid.readyState >= 2 && ctx) {
            let raw = '';
            if (native) {
              try {
                const found = await native.detect(vid);
                raw = found?.length ? found[0].rawValue : '';
              } catch { native = null; setDiag(d => d.replace('fast', 'standard')); }
            }
            // Always give jsQR the frame the native pass did not resolve, and
            // alternate centre crop / full frame so neither framing is favoured.
            if (!raw) { try { raw = readFrame(ctx, vid, flip++ % 2 ? 'full' : 'centre'); } catch { /* keep scanning */ } }
            if (raw && (raw !== lastVal || now - lastTime > 3000)) {
              lastVal = raw; lastTime = now;
              setStalled(false);
              doorSignal('read');
              onTokenRef.current(parseToken(raw));
            } else if (!lastVal && now - started > 7000) {
              setStalled(true);
            }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Full-resolution still as a fallback: the phone's own camera app focuses and
  // exposes far better than a live preview, so a photo decodes when video won't.
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      if (!cx) return;
      cx.drawImage(bmp, 0, 0, w, h);
      let code = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (!code) {
        // Retry on the centre of the photo, where the badge was aimed.
        const side = Math.round(Math.min(w, h) * 0.7);
        const sx = Math.round((w - side) / 2), sy = Math.round((h - side) / 2);
        code = jsQR(cx.getImageData(sx, sy, side, side).data, side, side, { inversionAttempts: 'attemptBoth' });
      }
      if (code?.data) { setStalled(false); doorSignal('read'); onTokenRef.current(parseToken(code.data)); }
      else toast({ title: 'No QR code in that photo', description: 'Fill more of the frame with the code and try again, or find the person by name below.', variant: 'destructive' });
    } catch {
      toast({ title: 'Could not read that photo', variant: 'destructive' });
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Camera className="h-4 w-4 text-primary" /> Scan a badge QR</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        {err ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">{err}</p>
        ) : (
          <div className="relative mx-auto max-w-xs aspect-square rounded-xl overflow-hidden bg-black">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            <div className="absolute inset-6 border-2 border-white/80 rounded-lg pointer-events-none" />
            {starting && <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm"><RefreshCw className="h-5 w-5 animate-spin mr-2" /> Starting camera…</div>}
            {!starting && diag && <div className="absolute bottom-1 right-2 text-[10px] text-white/60 tabular-nums">{diag}</div>}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2 text-center">Fill the white box with the code — about 15&nbsp;cm away. The scanner stays open, so you can check people in one after another.</p>
        {stalled && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-2 text-center">Nothing read yet. Move closer so the code fills the box, avoid glare on the screen — or take a photo instead.</p>
        )}
        <div className="mt-2 flex items-center justify-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Camera className="h-4 w-4 mr-2" /> Take a photo instead
          </Button>
          <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => {
            const how = doorSignal('admitted');
            toast(how === 'none'
              ? { title: 'This phone cannot vibrate from a web page', description: 'Android does it natively; iPhone needs iOS 17.4 or later. Watch the result card on screen instead.', variant: 'destructive' }
              : { title: how === 'vibrate' ? 'Buzzed' : 'Tapped (iOS haptic)', description: 'That is what a successful check-in will feel like.' });
          }}>
            <Vibrate className="h-4 w-4 mr-2" /> Test vibration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// The verdict, full screen and in colour. At a door nobody reads a card: the
// person in front of you is waiting, the queue is behind them, and the only two
// questions are "who is this" and "do they come in". So the whole screen answers
// them from arm's length — green in, amber seen-before, red stop — and the way
// out is one large button, because the next person is already stepping forward.
function ScanVerdict({ scan, windowLabel, onNext, onClose, onForce }: {
  scan: ScanResult;
  windowLabel: string;
  onNext: () => void;
  onClose: () => void;
  onForce: () => void;
}) {
  const state: DoorSignal = !scan.ok ? 'refused' : scan.already ? 'already' : 'admitted';
  // Shades chosen for contrast, not for prettiness: the Yacht Club is mostly
  // glass and this is read at arm's length. White on emerald-600 or amber-500
  // measures below 4.5:1, which washes the secondary lines out in daylight — so
  // the two white-text states go a shade darker, and amber flips to dark text.
  const skin = {
    admitted: { bg: 'bg-emerald-700', fg: 'text-white', ring: 'text-emerald-50', btn: 'bg-white text-emerald-800 hover:bg-white/90' },
    already: { bg: 'bg-amber-400', fg: 'text-amber-950', ring: 'text-amber-900', btn: 'bg-amber-950 text-amber-50 hover:bg-amber-900' },
    refused: { bg: 'bg-red-700', fg: 'text-white', ring: 'text-red-50', btn: 'bg-white text-red-800 hover:bg-white/90' },
  }[state];
  const headline = state === 'admitted' ? 'Come in' : state === 'already' ? 'Already checked in' : 'Do not admit';

  // Escape closes; Enter/Space moves to the next person without hunting for the
  // button, for whoever is holding a laptop rather than a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext]);

  return (
    <div className={`fixed inset-0 z-50 ${skin.bg} ${skin.fg} flex flex-col`} role="alertdialog" aria-live="assertive"
      aria-label={`${headline}. ${scan.name || ''}`}>
      <div className="flex justify-end p-3">
        <button onClick={onClose} aria-label="Close" className={`${skin.ring} hover:opacity-70 p-2`}><X className="h-7 w-7" /></button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3 min-h-0 overflow-y-auto">
        {state === 'refused' ? <X className="h-16 w-16 shrink-0" /> : <UserCheck className="h-16 w-16 shrink-0" />}
        <div className="text-3xl sm:text-4xl font-bold tracking-tight">{headline}</div>

        {scan.name && <div className="text-2xl sm:text-3xl font-semibold break-words max-w-full">{scan.name}</div>}
        {scan.company && <div className={`text-lg ${skin.ring} break-words max-w-full`}>{scan.company}</div>}
        {!!(scan.roles || []).length && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {(scan.roles || []).map(r => (
              <span key={r} className="text-sm bg-white/20 rounded-full px-3 py-0.5">{SM26_ROLE_LABELS[r] || r}</span>
            ))}
          </div>
        )}

        {state === 'refused' ? (
          // Say WHY. "Unknown token" on a cancelled registration sends the desk
          // hunting for a scanner fault that does not exist.
          <div className="mt-1 space-y-1">
            <div className="text-xl font-medium">{BLOCK_LABEL[scan.error || ''] || 'Unknown or invalid QR code'}</div>
            <div className={`text-sm ${skin.ring}`}>Nothing was recorded.</div>
          </div>
        ) : (
          <div className={`text-base ${skin.ring} mt-1`}>
            {state === 'already' ? 'Seen before in' : 'Checked in ·'} {windowLabel}
          </div>
        )}
      </div>

      <div className="p-4 pb-6 space-y-2 shrink-0">
        {state === 'refused' && scan.can_force && scan.attendee_id && (
          <Button variant="outline" size="lg"
            className="w-full h-12 bg-transparent border-white/70 text-white hover:bg-white/10 hover:text-white"
            onClick={onForce}>Admit anyway…</Button>
        )}
        <Button size="lg" className={`w-full h-16 text-lg font-semibold ${skin.btn}`} onClick={onNext}>
          <Camera className="h-5 w-5 mr-2" /> Scan next person
        </Button>
      </div>
    </div>
  );
}

export function AdminSM26Checkin() {
  const navigate = useNavigate();
  const [eventId, setEventId] = useState<string | null>(null);
  const [windows, setWindows] = useState<Win[]>([]);
  const [activeWindow, setActiveWindow] = useState<string>('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sound, setSound] = useState(isSoundOn());
  // attendee_id -> why the door would refuse them. Absent = free to walk in.
  const [eligibility, setEligibility] = useState<Record<string, string>>({});
  // Kept so a refusal can be re-sent as an override without rescanning the badge.
  const lastToken = useRef<string>('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data: ev } = await supabase.from('sm_event').select('id').eq('slug', 'sm26').maybeSingle();
    if (!ev) { setLoading(false); return; }
    const eid = (ev as { id: string }).id;
    setEventId(eid);
    await supabase.rpc('sm_ensure_badges', { p_event_id: eid });
    const [{ data: wins }, { data: rows }] = await Promise.all([
      supabase.from('sm_attendance_window').select('key,label,sort').eq('event_id', eid).order('sort'),
      supabase.from('sm_attendee')
        .select('id,first_name,last_name,email,is_primary,attending, registration:sm_registration!inner(id,company_name,status, roles:sm_role_assignment(role,status)), badge:sm_badge(checkin_token), checkins:sm_checkin(window_key)')
        .eq('event_id', eid).eq('attending', true).order('created_at', { ascending: true }),
    ]);
    const ws = (wins || []) as Win[];
    setWindows(ws);
    const initialWindow = activeWindow || ws[0]?.key || '';
    setActiveWindow(initialWindow);
    // This list IS the door list, so it must only hold people who are actually
    // coming: a withdrawn registration counts as much as a refused one.
    const OUT = ['declined', 'cancelled'];
    const list = ((rows || []) as Attendee[]).filter(a => !OUT.includes(regOf(a)?.status || ''));
    setAttendees(list);
    // The verdict comes from the server, so this screen shows exactly the rule
    // the door enforces rather than a second copy of it.
    const { data: elig } = await supabase.rpc('sm_checkin_eligibility_map', { p_event_id: eid });
    setEligibility(Object.fromEntries(
      ((elig || []) as { attendee_id: string; ok: boolean; reason: string | null }[])
        .filter(e => !e.ok).map(e => [e.attendee_id, e.reason || 'not_eligible'])));
    setLoading(false);

    // process a scanned token from the URL (?token=…)
    const token = new URLSearchParams(window.location.search).get('token');
    if (token && initialWindow) processToken(token, initialWindow);
  };

  const processToken = async (token: string, win: string) => {
    lastToken.current = token;
    const { data, error } = await supabase.rpc('sm_checkin_by_token', { p_token: token, p_window: win });
    if (error) { doorSignal('refused'); toast({ title: 'Check-in failed', description: error.message, variant: 'destructive' }); return; }
    const res = data as ScanResult;
    setScan(res);
    // The outcome is the fact that matters at the door, and it lands about a
    // second after the read — so it gets its own signal rather than sharing one.
    doorSignal(!res.ok ? 'refused' : res.already ? 'already' : 'admitted');
    if (res.ok) {
      // reflect locally on the matching attendee
      setAttendees(prev => prev.map(a => a.id === res.attendee_id
        ? { ...a, checkins: a.checkins.some(c => c.window_key === win) ? a.checkins : [...a.checkins, { window_key: win }] }
        : a));
      // clear token from the URL so a refresh doesn't re-scan
      const u = new URL(window.location.href); u.searchParams.delete('token'); window.history.replaceState({}, '', u.pathname);
    }
  };

  const manualCheckin = async (a: Attendee) => {
    if (!activeWindow) { toast({ title: 'Pick an attendance window first', variant: 'destructive' }); return; }
    // Someone the rules refuse can still be let in, but only deliberately and
    // only with a reason, which is stored on the check-in.
    const blocked = eligibility[a.id];
    let reason: string | null = null;
    if (blocked) {
      reason = prompt(`${nameOf(a)} cannot be admitted: ${BLOCK_LABEL[blocked] || blocked}.\n\nTo let them in anyway, type why (recorded against this check-in):`);
      if (!reason || !reason.trim()) return;
    }
    setBusy(a.id);
    const { data, error } = await supabase.rpc('sm_checkin_attendee', {
      p_attendee_id: a.id, p_window: activeWindow,
      p_force: !!blocked, p_force_reason: reason,
    });
    setBusy(null);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    const res = data as { ok?: boolean; already?: boolean; forced?: boolean; error?: string };
    if (res.ok === false) {
      toast({ title: 'Not admitted', description: BLOCK_LABEL[res.error || ''] || res.error, variant: 'destructive' });
      return;
    }
    setAttendees(prev => prev.map(x => x.id === a.id
      ? { ...x, checkins: x.checkins.some(c => c.window_key === activeWindow) ? x.checkins : [...x.checkins, { window_key: activeWindow }] }
      : x));
    toast({
      title: res.already ? 'Already checked in for this window' : res.forced ? 'Admitted by override' : 'Checked in',
      description: res.forced ? 'Recorded as an override with your reason.' : undefined,
    });
  };

  /** Let a refused scan through, deliberately and with a recorded reason. */
  const forceFromScan = async (res: ScanResult) => {
    if (!res.attendee_id || !activeWindow) return;
    const who = [res.name, res.company].filter(Boolean).join(' · ') || 'this person';
    const reason = prompt(`Admit ${who} anyway?\n\nRefused because: ${BLOCK_LABEL[res.error || ''] || res.error}.\nType why (recorded against this check-in):`);
    if (!reason || !reason.trim()) return;
    const { data, error } = await supabase.rpc('sm_checkin_by_token', {
      p_token: lastToken.current, p_window: activeWindow, p_force: true, p_force_reason: reason,
    });
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    setScan(data as ScanResult);
    toast({ title: 'Admitted by override', description: 'Recorded with your reason.' });
    load();
  };

  // Undo a check-in clicked by mistake (current window).
  const undoCheckin = async (a: Attendee) => {
    if (!activeWindow) return;
    setBusy(a.id);
    const { error } = await supabase.rpc('sm_uncheckin_attendee', { p_attendee_id: a.id, p_window: activeWindow });
    setBusy(null);
    if (error) { toast({ title: 'Could not undo', description: error.message, variant: 'destructive' }); return; }
    setAttendees(prev => prev.map(x => x.id === a.id
      ? { ...x, checkins: x.checkins.filter(c => c.window_key !== activeWindow) }
      : x));
    toast({ title: 'Check-in removed' });
  };

  const exportCsv = () => {
    const origin = window.location.origin;
    const head = ['First name', 'Last name', 'Email', 'Company', 'Roles', 'Checkin token', 'Checkin URL', 'Registration URL'];
    const rows = attendees.map(a => {
      const reg = regOf(a);
      return [
        a.first_name || '', a.last_name || '', a.email || '', companyOf(a),
        rolesOf(a).map(r => r.role).join('; '), tokenOf(a),
        `${origin}/admin/sm26/checkin?token=${tokenOf(a)}`,
        reg ? `${origin}/admin/sm26/${reg.id}` : '',
      ];
    });
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'sm26-attendees.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-8 w-8 animate-spin text-gray-400" /></div>;

  const countFor = (win: string) => attendees.filter(a => a.checkins.some(c => c.window_key === win)).length;
  const totalCheckedIn = attendees.filter(a => a.checkins.length > 0).length;
  const blockedSummary = attendees.reduce((acc, a) => {
    const r = eligibility[a.id];
    if (r) { acc.total++; acc.byReason[r] = (acc.byReason[r] || 0) + 1; }
    return acc;
  }, { total: 0, byReason: {} as Record<string, number> });
  const filtered = attendees.filter(a => {
    if (!search) return true;
    const hay = `${a.first_name || ''} ${a.last_name || ''} ${a.email || ''} ${companyOf(a)}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin/sm26')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to registrations</Button>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><QrCode className="h-6 w-6 text-primary" /> Check-in</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => load()} title="Refresh headcount"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-9 w-9" title={sound ? 'Sound on — tap to silence' : 'Silent — tap for sound'}
            onClick={() => { const on = !sound; setSoundPref(on); setSound(on); if (on) { primeAudio(); doorSignal('read'); } }}>
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-gray-400" />}
          </Button>
          {/* Opening the scanner is the tap that lets iOS start the audio context. */}
          <Button className="gap-1.5" onClick={() => { primeAudio(); setScanning(s => !s); }}><Camera className="h-4 w-4" /> {scanning ? 'Close scanner' : 'Scan QR'}</Button>
          <Button variant="outline" className="gap-1.5" onClick={exportCsv}><Download className="h-4 w-4" /> Export attendees (CSV)</Button>
        </div>
      </div>

      {scanning && (
        <QrScanner
          paused={!!scan}
          onClose={() => setScanning(false)}
          onToken={(token) => { if (activeWindow) processToken(token, activeWindow); }}
        />
      )}

      {/* Scan result — full screen, because at the door nobody reads a card. */}
      {scan && (
        <ScanVerdict
          scan={scan}
          windowLabel={windows.find(w => w.key === activeWindow)?.label || ''}
          onClose={() => setScan(null)}
          onNext={() => { primeAudio(); setScan(null); setScanning(true); }}
          onForce={() => forceFromScan(scan)}
        />
      )}

      {/* Window selector + headcount */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Active window for new check-ins</div>
          <div className="flex flex-wrap gap-2">
            {windows.map(w => (
              <button key={w.key} onClick={() => setActiveWindow(w.key)}
                className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${activeWindow === w.key ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-primary/40'}`}>
                <div className="font-medium">{w.label}</div>
                <div className="text-xs opacity-70">{countFor(w.key)} checked in</div>
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-500 mt-3">Unique attendees on-site: <span className="font-semibold text-gray-900">{totalCheckedIn}</span> / {attendees.length}</div>
        </CardContent>
      </Card>

      {/* Readiness — so a data problem is found now, not at the door on the day. */}
      {blockedSummary.total > 0 && (
        <Card className="border-0 shadow-sm bg-amber-50">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-amber-900">
              {blockedSummary.total} of {attendees.length} would be refused at the door today
            </div>
            <p className="text-xs text-amber-800 mt-1">
              Admission requires a <b>confirmed</b> registration, a <b>settled</b> fee (paid or waived),
              and — for anyone holding a jury role — that they have said on their account they are coming on site.
              Fix these in the registration sheets, or admit them one by one with a recorded reason.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(blockedSummary.byReason).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                <Badge key={reason} className="text-[10px] bg-white text-amber-800 border-amber-200">
                  {n} · {BLOCK_LABEL[reason] || reason}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual search + check-in */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search to check in by name…" className="pl-9 h-9" />
      </div>

      <div className="space-y-2">
        {filtered.map(a => {
          const here = a.checkins.some(c => c.window_key === activeWindow);
          const name = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || '(no name)';
          return (
            <Card key={a.id} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{name}</span>
                    {!a.is_primary && <Badge variant="outline" className="text-[10px] gap-1 text-gray-500"><Users className="h-2.5 w-2.5" /> guest</Badge>}
                    {rolesOf(a).filter(r => r.status !== 'declined').map((r, i) => <Badge key={i} variant="secondary" className="text-[10px]">{SM26_ROLE_LABELS[r.role] || r.role}</Badge>)}
                    {eligibility[a.id] && (
                      <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200">
                        {BLOCK_LABEL[eligibility[a.id]] || eligibility[a.id]}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{companyOf(a)}</div>
                  {a.checkins.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {windows.filter(w => a.checkins.some(c => c.window_key === w.key)).map(w => (
                        <Badge key={w.key} className="bg-green-50 text-green-700 border-green-200 text-[10px]">{w.label}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                {here ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge className="bg-green-50 text-green-700 border-green-200"><Check className="h-3 w-3 mr-1" /> In</Badge>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-red-600" disabled={busy === a.id} onClick={() => undoCheckin(a)} title="Undo check-in for this window">
                      <Undo2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" disabled={busy === a.id} onClick={() => manualCheckin(a)}>Check in</Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

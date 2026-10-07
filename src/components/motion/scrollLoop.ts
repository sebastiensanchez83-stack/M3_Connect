/**
 * One passive scroll listener for everything that follows the scroll (parallax
 * photos, the sticky stack, the hero media), read once per animation frame.
 * Subscribers are called with no argument: they read what they need
 * (window.scrollY, getBoundingClientRect) themselves.
 *
 * A subscriber is also called once right after it subscribes, and on resize.
 */
type Frame = () => void;

const subscribers = new Set<Frame>();
let frame = 0;
let listening = false;

function flush() {
  frame = 0;
  subscribers.forEach((fn) => fn());
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}

export function subscribeScroll(fn: Frame): () => void {
  subscribers.add(fn);
  if (!listening) {
    listening = true;
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
  }
  // First reading right away (layout is settled by the time effects run).
  fn();
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && listening) {
      listening = false;
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }
  };
}

/** Ask every subscriber to read again on the next frame (a layout change that is not a scroll). */
export function requestScrollFrame() {
  if (subscribers.size) schedule();
}

/**
 * A ticker for continuous motion (currently unused: the giant marquees are gone): one requestAnimationFrame
 * loop shared by all, with the page's scroll speed turned into a `boost` that
 * pushes the marquees (up to x5, easing back down). Runs only while something
 * subscribes.
 */
export type Tick = (dtSeconds: number, boost: number) => void;

const ticks = new Set<Tick>();
let raf = 0;
let lastT: number | null = null;
let lastY = 0;
let boost = 0;

function loop(t: number) {
  if (lastT === null) {
    lastT = t;
    lastY = window.scrollY;
  }
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  const y = window.scrollY;
  const ds = Math.abs(y - lastY);
  lastY = y;
  const target = Math.min(4, ds / 8);
  boost += (target - boost) * (target > boost ? 0.3 : 0.04);
  ticks.forEach((fn) => fn(dt, boost));
  raf = requestAnimationFrame(loop);
}

export function subscribeTicker(fn: Tick): () => void {
  ticks.add(fn);
  if (!raf) {
    lastT = null;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    ticks.delete(fn);
    if (!ticks.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

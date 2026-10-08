import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Optional fallback UI — if omitted the default branded page is shown. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const CHUNK_RELOAD_FLAG = 'smc:chunk-reload-attempted';

/** Detect stale-chunk errors from Vite/Webpack dynamic imports. */
function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    (err instanceof Error && err.name === 'ChunkLoadError')
  );
}

/**
 * React Error Boundary that catches render-time errors in its subtree and
 * displays a user-friendly fallback with Smart Marina Connect branding.
 *
 * Special-cases stale chunk errors after a new deploy: if the user's browser
 * has a cached `index.html` pointing to old asset hashes, the dynamic import
 * will fail. We detect this and trigger a single hard reload to fetch fresh
 * assets — all transparent to the user.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stale-deploy recovery: reload once per session to pick up new chunk paths.
    if (isChunkLoadError(error) && typeof window !== 'undefined') {
      const alreadyReloaded =
        window.sessionStorage.getItem(CHUNK_RELOAD_FLAG) === 'true';
      if (!alreadyReloaded) {
        window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, 'true');
        // eslint-disable-next-line no-console
        console.warn(
          '[ErrorBoundary] Stale chunk detected — reloading once to fetch fresh assets.'
        );
        window.location.reload();
        return;
      }
    }
    // Log to console in dev; could be forwarded to an external service later.
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoHome = () => {
    // Navigate using the History API so we don't need a hook inside a class component.
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      // The 404's grammar (NotFoundPage): a navy-deep panel, a small caps line,
      // a short title, one sentence and the ways out as rolling buttons. Kept to
      // plain markup, Tailwind and the Button on purpose: whatever crashed must
      // not be needed to draw this (no i18n hook, no router hook, no kit piece
      // that loads data or animates). Navy also keeps a transparent header
      // (still over a hero that just crashed) readable.
      return (
        <div className="bg-navy-deep text-white">
          <div className="mx-auto flex min-h-[60vh] max-w-7xl flex-col justify-center px-4 py-20 sm:px-6 md:py-28">
            <p className="flex items-center gap-2 text-[13px] font-semibold uppercase leading-4 tracking-[0.08em] text-white/75">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              Error
            </p>
            <h1 className="mt-6 text-h1-sm text-white sm:text-h1">Something went wrong</h1>
            <p className="mt-3 max-w-xl text-body text-white/85 md:text-body-lg">
              An unexpected error occurred. You can try reloading this section or
              return to the home page.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button type="button" variant="ctaOnDark" onClick={this.handleReset}>
                Try again
              </Button>
              <Button type="button" variant="ctaLight" onClick={this.handleGoHome}>
                Back to home
              </Button>
            </div>

            {/* Error detail (dev-friendly, collapsed) */}
            {this.state.error && (
              <details className="mt-10 max-w-xl rounded-field bg-white/[0.07] text-sm ring-1 ring-inset ring-white/15">
                <summary className="cursor-pointer rounded-field px-4 py-3 font-semibold text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgb(var(--navy-deep)),0_0_0_4px_#fff]">
                  Technical details
                </summary>
                <pre className="whitespace-pre-wrap break-words px-4 pb-4 font-mono text-[13px] leading-5 text-white/75">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

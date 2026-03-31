import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional fallback UI — if omitted the default branded page is shown. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that catches render-time errors in its subtree and
 * displays a user-friendly fallback with M3 Connect branding.
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

      return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
          <div className="max-w-md w-full text-center">
            {/* Brand mark */}
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-6">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>

            <h1 className="text-2xl font-bold text-[#0b2653] mb-2">
              Something went wrong
            </h1>
            <p className="text-gray-600 mb-6">
              An unexpected error occurred. You can try reloading this section or
              return to the home page.
            </p>

            {/* Error detail (dev-friendly, collapsed) */}
            {this.state.error && (
              <details className="mb-6 text-left bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-500">
                <summary className="cursor-pointer font-medium text-gray-700">
                  Technical details
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words">
                  {this.state.error.message}
                </pre>
              </details>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                Try again
              </button>
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-[#0b2653] text-white hover:bg-[#0b2653]/90 transition-colors"
              >
                <Home className="h-4 w-4" />
                Go Home
              </button>
            </div>

            <p className="mt-8 text-xs text-gray-400">M3 Connect</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

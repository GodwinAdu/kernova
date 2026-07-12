/**
 * KernovaErrorBoundary — React error boundary for agent interactions.
 *
 * Catches errors in agent hooks and displays a fallback UI.
 *
 * Usage:
 *   import { KernovaErrorBoundary } from '@kernova/framework/react';
 *
 *   <KernovaErrorBoundary fallback={<p>Something went wrong</p>}>
 *     <ChatPage />
 *   </KernovaErrorBoundary>
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

export interface KernovaErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI to show when an error occurs */
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that catches errors in Kernova hook components.
 * Provides retry functionality out of the box.
 */
export class KernovaErrorBoundary extends Component<KernovaErrorBoundaryProps, State> {
  constructor(props: KernovaErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  retry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error, this.retry);
        }
        return this.props.fallback;
      }

      // Default fallback
      return (
        <div role="alert" style={{ padding: '1rem', border: '1px solid #f5c6cb', borderRadius: '8px', background: '#fff5f5' }}>
          <h3 style={{ margin: '0 0 0.5rem', color: '#721c24' }}>Something went wrong</h3>
          <p style={{ margin: '0 0 1rem', color: '#856404' }}>{this.state.error.message}</p>
          <button
            onClick={this.retry}
            style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #ddd', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

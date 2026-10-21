import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/Button.tsx';
import { ButtonLink } from '@/components/ButtonLink.tsx';
import { ErrorState } from '@/components/ErrorState.tsx';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Keeps a bug in one page from blanking the whole app. The shell stays, the
 * reader is told what happened, and saved data is untouched.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        title="This page could not be shown"
        actions={
          <>
            <Button
              onClick={() => {
                this.setState({ failed: false });
              }}
            >
              Try again
            </Button>
            <ButtonLink to="/" variant="secondary">
              Go to Overview
            </ButtonLink>
          </>
        }
      >
        Something went wrong while drawing this page. Your saved events are not affected.
      </ErrorState>
    );
  }
}

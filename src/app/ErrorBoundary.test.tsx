import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.tsx';

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom');
  return <p>All fine</p>;
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows what happened and a way out instead of a blank screen, then recovers', async () => {
    // React reports the caught error to the console; keep the test output clean.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    function Harness() {
      const [explode, setExplode] = useState(true);
      return (
        <MemoryRouter>
          <button
            type="button"
            onClick={() => {
              setExplode(false);
            }}
          >
            Fix it
          </button>
          <ErrorBoundary>
            <Bomb explode={explode} />
          </ErrorBoundary>
        </MemoryRouter>
      );
    }
    render(<Harness />);

    const alert = screen.getByRole('alert', { name: 'This page could not be shown' });
    expect(alert).toHaveTextContent('Your saved events are not affected');
    expect(screen.getByRole('link', { name: 'Go to Overview' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(log).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Fix it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('All fine')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

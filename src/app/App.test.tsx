import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './AppRoutes.tsx';
import { PlannerProvider } from './state/PlannerProvider.tsx';

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PlannerProvider>
        <AppRoutes />
      </PlannerProvider>
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('redirects to the event page and offers the sample', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Event' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load sample wedding' }),
    ).toBeInTheDocument();
  });

  it('loads the sample, persists it, and can clear it', async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Load sample wedding' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Meera & Arjun’s Wedding' }),
    ).toBeInTheDocument();
    expect(screen.getByText('₹15,00,000')).toBeInTheDocument();

    unmount();
    renderApp();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Meera & Arjun’s Wedding' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear event' }));
    expect(screen.getByText('No event yet')).toBeInTheDocument();
  });

  it('navigates between sections with the main navigation', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Budget' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Budget' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows a not-found page for unknown routes', () => {
    renderApp('/nope');
    expect(screen.getByText('That page does not exist')).toBeInTheDocument();
  });
});

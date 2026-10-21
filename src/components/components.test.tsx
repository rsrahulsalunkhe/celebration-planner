import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';
import { ButtonLink } from './ButtonLink.tsx';
import { Card } from './Card.tsx';
import { Checkbox } from './Checkbox.tsx';
import { CheckboxGroup } from './CheckboxGroup.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { FactList } from './FactList.tsx';
import { Select } from './Select.tsx';
import { StatusMessage } from './StatusMessage.tsx';
import { TextField } from './TextField.tsx';

describe('Button', () => {
  it('keeps a text label for icon-only buttons', () => {
    render(
      <Button icon={<svg aria-hidden="true" />} hideLabel>
        Remove guest
      </Button>,
    );
    // The label is in the page for assistive technology, and is what names the button.
    expect(screen.getByRole('button', { name: 'Remove guest' })).toBeInTheDocument();
    expect(screen.getByText('Remove guest')).toHaveClass('srOnly');
  });

  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button');
  });

  it('ButtonLink is a real link that looks like a button', () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/new">New event</ButtonLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'New event' })).toHaveAttribute(
      'href',
      '/new',
    );
  });
});

describe('form controls', () => {
  it('TextField ties label, hint and error to the input', () => {
    render(
      <TextField
        name="city"
        label="City"
        value=""
        required
        hint="Where it happens"
        error="City is required"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('City (required)');
    expect(input).toHaveAttribute('id', 'field-city');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Where it happens City is required');
  });

  it('TextField has no invalid state or description without an error or hint', () => {
    render(<TextField name="city" label="City" value="" onChange={() => undefined} />);
    const input = screen.getByLabelText('City');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('TextField reports typed text and can be multiline', async () => {
    const onChange = vi.fn();
    render(
      <TextField name="notes" label="Notes" value="" multiline onChange={onChange} />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('Select is a native select with a placeholder and typed values', async () => {
    const onChange = vi.fn();
    render(
      <Select
        name="type"
        label="Type"
        value=""
        placeholder="Choose…"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        onChange={onChange}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Type' });
    expect(select.tagName).toBe('SELECT');
    await userEvent.selectOptions(select, 'Beta');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('Checkbox and CheckboxGroup are native, grouped and keyboard operable', async () => {
    function Harness() {
      const [selected, setSelected] = useState<('x' | 'y')[]>([]);
      return (
        <>
          <CheckboxGroup
            name="things"
            legend="Things"
            hint="Pick some"
            options={[
              { value: 'x', label: 'Thing X' },
              { value: 'y', label: 'Thing Y' },
            ]}
            selected={selected}
            onChange={setSelected}
          />
          <p>Selected: {selected.join(',') || 'none'}</p>
        </>
      );
    }
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Things' });
    expect(group).toHaveAccessibleDescription('Pick some');
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(screen.getByText('Selected: x')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Thing Y' }));
    expect(screen.getByText('Selected: x,y')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Thing X' }));
    expect(screen.getByText('Selected: y')).toBeInTheDocument();
  });

  it('a lone Checkbox can be disabled', () => {
    render(
      <Checkbox label="Agree" checked={false} disabled onChange={() => undefined} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Agree' })).toBeDisabled();
  });
});

describe('StatusMessage', () => {
  it('stays in the page when empty, so a later message is announced', () => {
    const { rerender } = render(<StatusMessage message={null} />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    rerender(<StatusMessage message="Saved your changes." />);
    expect(screen.getByRole('status')).toBe(region); // same element, new text
    expect(region).toHaveTextContent('Saved your changes.');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('announces errors immediately', () => {
    render(<StatusMessage message="Could not save." tone="error" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('Could not save.');
  });
});

describe('Card, Badge, EmptyState, ErrorState and FactList', () => {
  it('a Card is a region named by its own heading', () => {
    render(
      <Card title="Guests" actions={<button type="button">Act</button>}>
        body
      </Card>,
    );
    const region = screen.getByRole('region', { name: 'Guests' });
    expect(
      within(region).getByRole('heading', { level: 2, name: 'Guests' }),
    ).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });

  it('a Card can nest at heading level 3', () => {
    render(<Card title="Inner" headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Inner' })).toBeInTheDocument();
  });

  it('a Badge carries its meaning in text', () => {
    render(<Badge tone="coral">Demo</Badge>);
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('an EmptyState explains and offers a next step, without being an alert', () => {
    render(
      <EmptyState title="Nothing yet" actions={<button type="button">Start</button>}>
        Add something.
      </EmptyState>,
    );
    expect(screen.getByRole('region', { name: 'Nothing yet' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('an ErrorState is announced as an alert and keeps its actions', () => {
    render(
      <ErrorState
        title="Broken"
        tone="warning"
        actions={<button type="button">Retry</button>}
      >
        It broke.
      </ErrorState>,
    );
    const alert = screen.getByRole('alert', { name: 'Broken' });
    expect(within(alert).getByText('It broke.')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('FactList ties each label to its value', () => {
    render(<FactList facts={[{ label: 'Date', value: '1 Jan' }]} />);
    expect(screen.getByRole('term')).toHaveTextContent('Date');
    expect(screen.getByRole('definition')).toHaveTextContent('1 Jan');
  });
});

describe('ConfirmDialog', () => {
  function Harness({ onConfirm = () => undefined }: { onConfirm?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Delete thing
        </button>
        <ConfirmDialog
          open={open}
          title="Delete the thing?"
          confirmLabel="Yes, delete"
          onCancel={() => {
            setOpen(false);
          }}
          onConfirm={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          It will be gone for good.
        </ConfirmDialog>
      </>
    );
  }

  it('is closed until opened, then is a named modal dialog with a description', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete thing' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete the thing?' });
    expect(dialog).toHaveAccessibleDescription('It will be gone for good.');
    expect(dialog).toHaveAttribute('open');
  });

  it('puts focus on Cancel, the safe choice, when it opens', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete thing' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const opener = screen.getByRole('button', { name: 'Delete thing' });
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes when the browser reports a cancel (its own Escape handling)', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Delete thing' });
    await userEvent.click(opener);
    screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });

  it('closes on a click on the backdrop but not on the content', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete thing' }));
    await userEvent.click(screen.getByText('It will be gone for good.'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('dialog')); // the dialog element itself is the backdrop area
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms only when the confirm button is pressed', async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const opener = screen.getByRole('button', { name: 'Delete thing' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

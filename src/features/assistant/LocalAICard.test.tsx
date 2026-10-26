import type { InitProgressReport } from '@mlc-ai/web-llm';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/app/AppRoutes.tsx';
import { CalendarContext } from '@/app/state/plannerContext.ts';
import { PlannerProvider } from '@/app/state/PlannerProvider.tsx';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { startingBudgetOperations } from '@/domain/planning/budget.ts';
import type { CapabilityEnvironment } from '@/services/ai/local/capability.ts';
import {
  LocalModelController,
  type EngineLike,
  type LocalModelDependencies,
} from '@/services/ai/local/localModel.ts';
import { LOCAL_MODEL } from '@/services/ai/local/model.ts';
import { SAVED_STATE_KEY, serializeSavedState } from '@/services/storage.ts';
import { MemoryStorage, TODAY, fixedCalendar, presetEvent } from '@/test/helpers.ts';
import { LocalModelContext } from './localModelContext.ts';

/* A fake SDK and engine: these tests cover the page, not real inference. */

class FakeWorker {
  terminated = false;
  terminate() {
    this.terminated = true;
  }
}

function setUp(
  options: { gpu?: boolean; load?: () => Promise<void>; reply?: string } = {},
) {
  const workers: FakeWorker[] = [];
  const engine: EngineLike = {
    interruptGenerate: vi.fn(),
    unload: vi.fn(() => Promise.resolve()),
    chatCompletion: vi.fn(() =>
      Promise.resolve({
        async *[Symbol.asyncIterator]() {
          await Promise.resolve();
          yield { choices: [{ delta: { content: options.reply ?? '' } }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      }),
    ),
  };
  const environment: CapabilityEnvironment = {
    isSecureContext: true,
    hasWorker: true,
    gpu:
      options.gpu === false
        ? undefined
        : {
            requestAdapter: () =>
              Promise.resolve({ features: new Set(['shader-f16']), limits: {} }),
          },
    deviceMemoryGb: 8,
    storageEstimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }),
  };
  const deps: LocalModelDependencies = {
    loadSdk: vi.fn(() =>
      Promise.resolve({
        CreateWebWorkerMLCEngine: async (
          _worker: Worker,
          _id: string,
          config: { initProgressCallback: (report: InitProgressReport) => void },
        ) => {
          config.initProgressCallback({
            progress: 0.42,
            text: 'Fetching param cache[3/30]',
            timeElapsed: 2,
          });
          await (options.load?.() ?? Promise.resolve());
          return engine;
        },
        hasModelInCache: () => Promise.resolve(false),
        deleteModelAllInfoInCache: () => Promise.resolve(),
        prebuiltAppConfig: {
          model_list: [{ model_id: LOCAL_MODEL.ids.f16, model: LOCAL_MODEL.source }],
        },
      }),
    ),
    createWorker: vi.fn(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }),
    environment: () => environment,
    fetchJson: () => Promise.resolve({ records: [{ nbytes: 868_547_584 }] }),
  };
  const controller = new LocalModelController(deps);

  const base = presetEvent('wedding');
  const record = applyOperations(
    base,
    startingBudgetOperations(base, PLANNING_CONFIGURATION, TODAY),
  );
  if (!record) throw new Error('fixture');
  const storage = new MemoryStorage();
  storage.data.set(
    SAVED_STATE_KEY,
    serializeSavedState({ activeEventId: record.profile.id, events: [record] }),
  );
  render(
    <MemoryRouter initialEntries={['/assistant']}>
      <CalendarContext value={fixedCalendar(TODAY)}>
        <LocalModelContext value={controller}>
          <PlannerProvider storage={storage}>
            <AppRoutes />
          </PlannerProvider>
        </LocalModelContext>
      </CalendarContext>
    </MemoryRouter>,
  );
  return { controller, deps, engine, workers };
}

const card = () => screen.getByRole('region', { name: 'Local AI (optional)' });
const log = () => screen.getByRole('region', { name: 'Messages' });
async function say(text: string) {
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Message' }),
    `${text}{Enter}`,
  );
}

describe('local AI on the assistant page', () => {
  it('downloads nothing on page load and explains what enabling involves', () => {
    const { deps } = setUp();
    expect(within(card()).getByText('Off')).toBeInTheDocument();
    expect(
      within(card()).getByText(/Nothing is downloaded until you choose to/),
    ).toBeInTheDocument();
    expect(
      within(card()).getByText(
        /served by third parties \(huggingface\.co and raw\.githubusercontent\.com\)/,
      ),
    ).toBeInTheDocument();
    expect(within(card()).getByText(/never sent to an AI service/)).toBeInTheDocument();
    expect(deps.loadSdk).not.toHaveBeenCalled();
    expect(deps.createWorker).not.toHaveBeenCalled();
  });

  it('on an unsupported device says why and leaves the guided planner fully usable (completion check)', async () => {
    setUp({ gpu: false });
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Enable local AI' }),
    );
    expect(await within(card()).findByText(/does not offer WebGPU/)).toBeInTheDocument();
    expect(
      within(card()).getByText(/guided planner below keeps working/),
    ).toBeInTheDocument();
    await say('Set guests to 120');
    const reply = within(log()).getByText('Proposed change').closest('li');
    if (!reply) throw new Error('no reply');
    expect(within(reply).getByText('Guided planner')).toBeInTheDocument();
    expect(
      within(reply).getByRole('button', { name: 'Apply change' }),
    ).toBeInTheDocument();
  });

  it('shows the verified size before downloading, and Stop download ends the worker', async () => {
    let finish: () => void = () => undefined;
    const { workers } = setUp({
      load: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Enable local AI' }),
    );
    expect(
      await within(card()).findByText(
        /Download: about 869 MB of model weights \(from the model’s own file list\)/,
      ),
    ).toBeInTheDocument();
    expect(
      within(card()).getByRole('link', { name: 'Apache-2.0 license' }),
    ).toHaveAttribute('href', LOCAL_MODEL.licenseUrl);
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Download and start' }),
    );
    expect(await within(card()).findByRole('progressbar')).toHaveAttribute(
      'value',
      '0.42',
    );
    expect(within(card()).getByText(/42%/)).toBeInTheDocument();
    await userEvent.click(within(card()).getByRole('button', { name: 'Stop download' }));
    expect(workers[0]?.terminated).toBe(true);
    expect(
      within(card()).getByText(
        /Download stopped\. The worker that was downloading was ended/,
      ),
    ).toBeInTheDocument();
    finish();
  });

  it('when ready, labels model-written drafts and keeps commands with the planner', async () => {
    const { engine } = setUp({
      reply:
        'Dear friends, please join us on 19 January 2027 in Pune to celebrate. RSVP to [RSVP contact] by [RSVP date].',
    });
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Enable local AI' }),
    );
    await userEvent.click(
      await within(card()).findByRole('button', { name: 'Download and start' }),
    );
    expect(
      await within(card()).findByText(/Local AI is ready \(.*\), running on this device/),
    ).toBeInTheDocument();

    await say('Write invitation wording');
    const reply = (await within(log()).findByText('Invitation wording')).closest('li');
    if (!reply) throw new Error('no reply');
    expect(within(reply).getByText('Local AI')).toBeInTheDocument();
    expect(within(reply).getByText(/AI-written draft/)).toBeInTheDocument();
    expect(within(reply).getByText(/It can be wrong or generic/)).toBeInTheDocument();
    expect(
      within(reply).getByText(/please join us on 19 January 2027/),
    ).toBeInTheDocument();

    await say('Set guests to 120');
    const proposal = within(log()).getByText('Proposed change').closest('li');
    if (!proposal) throw new Error('no proposal');
    expect(within(proposal).getByText('Guided planner')).toBeInTheDocument();
    expect(engine.chatCompletion).toHaveBeenCalledTimes(1);

    await userEvent.click(within(card()).getByRole('checkbox', { name: /Use local AI/ }));
    await say('Write invitation wording');
    expect(engine.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load once and retries only when asked', async () => {
    const { deps } = setUp({ load: () => Promise.reject(new Error('Failed to fetch')) });
    await userEvent.click(
      within(card()).getByRole('button', { name: 'Enable local AI' }),
    );
    await userEvent.click(
      await within(card()).findByRole('button', { name: 'Download and start' }),
    );
    expect(
      await within(card()).findByText(/could not be downloaded/),
    ).toBeInTheDocument();
    expect(deps.createWorker).toHaveBeenCalledTimes(1);
    await userEvent.click(within(card()).getByRole('button', { name: 'Try again' }));
    expect(
      await within(card()).findByRole('button', { name: 'Download and start' }),
    ).toBeInTheDocument();
    expect(deps.createWorker).toHaveBeenCalledTimes(1);
  });
});

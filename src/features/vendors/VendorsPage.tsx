import { GitCompare, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActiveEventGate } from '@/app/ActiveEventGate.tsx';
import { usePlannerDispatch } from '@/app/state/plannerContext.ts';
import { Badge } from '@/components/Badge.tsx';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { CheckboxGroup } from '@/components/CheckboxGroup.tsx';
import type { Option } from '@/components/options.ts';
import { PageHeader } from '@/components/PageHeader.tsx';
import { Select } from '@/components/Select.tsx';
import { Stack } from '@/components/Stack.tsx';
import { StatusMessage, type StatusTone } from '@/components/StatusMessage.tsx';
import { useSettled } from '@/components/useSettled.ts';
import { TextField } from '@/components/TextField.tsx';
import { EVENT_TYPE_LABELS, VENDOR_STATUS_LABELS } from '@/data/labels.ts';
import { SAMPLE_VENDOR_DISCLOSURE, SAMPLE_VENDORS } from '@/data/sampleVendors.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { createId } from '@/domain/ids.ts';
import { formatMoney } from '@/domain/money.ts';
import {
  CAPABILITY_LABELS,
  VENDOR_KIND_LABELS,
  matchVendors,
  priceText,
  shortlistSample,
  vendorCandidates,
  vendorRequirements,
  type VendorMatch,
} from '@/domain/planning/vendors.ts';
import { CAPABILITIES, LIMITS } from '@/domain/primitives.ts';
import type {
  Capability,
  ChangeOperation,
  EventRecord,
  VendorKind,
} from '@/domain/types.ts';
import styles from './Vendors.module.css';
import { VendorRecord } from './VendorRecord.tsx';
import { AddVendorCard } from './AddVendorCard.tsx';
import { CompareCard } from './CompareCard.tsx';
import { KIND_OPTIONS, MAX_COMPARE, OUTCOME_WORDS } from './vendorPresentation.ts';

const CAPABILITY_OPTIONS: Option<Capability>[] = CAPABILITIES.map((value) => ({
  value,
  label: CAPABILITY_LABELS[value],
}));

export function VendorsPage() {
  return (
    <ActiveEventGate title="Vendors">
      {(event) => <VendorWorkspace key={event.profile.id} event={event} />}
    </ActiveEventGate>
  );
}

function matchesSearch(match: VendorMatch, text: string): boolean {
  const q = text.trim().toLocaleLowerCase('en-IN');
  if (!q) return true;
  const { candidate } = match;
  const haystack = [
    candidate.name,
    VENDOR_KIND_LABELS[candidate.kind],
    candidate.sample?.summary ?? '',
    ...(candidate.sample?.serviceAreas ?? []),
    candidate.vendor?.serviceArea ?? '',
    candidate.vendor?.notes ?? '',
    // Only what they can do: searching "halal" must not find a caterer that cannot.
    ...Object.entries({
      ...candidate.sample?.capabilities,
      ...candidate.vendor?.capabilities,
    }).flatMap(([c, can]) => (can ? [CAPABILITY_LABELS[c as Capability]] : [])),
  ]
    .join(' ')
    .toLocaleLowerCase('en-IN');
  return haystack.includes(q);
}

function VendorWorkspace({ event }: { event: EventRecord }) {
  const dispatch = usePlannerDispatch();
  const [message, setMessage] = useState<{ text: string; tone: StatusTone } | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<VendorKind | ''>('');
  const [extra, setExtra] = useState<Capability[]>([]);
  const [compare, setCompare] = useState<string[]>([]);

  const commit = (operations: readonly ChangeOperation[], success: string): boolean => {
    if (operations.length === 0 || !applyOperations(event, operations)) {
      setMessage({
        text: 'That change could not be saved. Check the details and try again.',
        tone: 'error',
      });
      return false;
    }
    dispatch({
      type: 'event/edit',
      eventId: event.profile.id,
      operations,
      expectedRevision: event.profile.revision,
    });
    setMessage({ text: success, tone: 'success' });
    return true;
  };

  // Matching depends on the event and the extra needs only, not on the search text.
  const requirements = useMemo(() => vendorRequirements(event, extra), [event, extra]);
  const matches = useMemo(
    () => matchVendors(event, vendorCandidates(event, SAMPLE_VENDORS), requirements),
    [event, requirements],
  );
  const visible = matches.filter(
    (m) => (kind === '' || m.candidate.kind === kind) && matchesSearch(m, search),
  );
  const suitable = visible.filter((m) => m.status === 'suitable');
  const confirm = visible.filter((m) => m.status === 'needs-confirmation');
  const excluded = visible.filter((m) => m.status === 'unsuitable');
  const counts = `${suitable.length.toString()} suitable, ${confirm.length.toString()} need confirmation, ${excluded.length.toString()} not suitable.`;
  const settledCounts = useSettled(counts);
  const compared = compare.flatMap((key) => {
    const found = matches.find((m) => m.candidate.key === key);
    return found ? [found] : [];
  });

  const toggleCompare = (key: string, name: string) => {
    if (compare.includes(key)) {
      setCompare((list) => list.filter((k) => k !== key));
      setMessage({ text: `Removed ${name} from the comparison.`, tone: 'info' });
    } else if (compare.length >= MAX_COMPARE) {
      setMessage({
        text: `You can compare up to ${MAX_COMPARE} vendors. Remove one first.`,
        tone: 'error',
      });
    } else {
      setCompare((list) => [...list, key]);
      setMessage({ text: `Added ${name} to the comparison.`, tone: 'info' });
    }
  };

  const shortlist = (match: VendorMatch) => {
    const { sample } = match.candidate;
    if (!sample) return;
    commit(
      [{ op: 'vendors/upsert', item: shortlistSample(sample, createId('vendor')) }],
      `Shortlisted ${sample.name}. It is sample data: confirm everything with a real vendor.`,
    );
  };

  const kindsNeeding = (Object.keys(requirements.byKind) as VendorKind[]).filter(
    (k) => requirements.byKind[k].length > 0,
  );

  const renderResult = (m: VendorMatch) => {
    const { candidate } = m;
    const { sample, vendor } = candidate;
    const inCompare = compare.includes(candidate.key);
    return (
      <li key={candidate.key} className={styles.result}>
        <h4>{candidate.name}</h4>
        <div className={styles.badges}>
          {sample ? (
            <Badge tone="gold">Sample data</Badge>
          ) : (
            <Badge tone="success">Your record</Badge>
          )}
          <Badge>{VENDOR_KIND_LABELS[candidate.kind]}</Badge>
          {m.status === 'needs-confirmation' ? (
            <Badge tone="gold">Needs confirmation</Badge>
          ) : null}
          {m.status === 'unsuitable' ? <Badge tone="coral">Not suitable</Badge> : null}
          {vendor ? (
            <Badge tone="navy">On your list: {VENDOR_STATUS_LABELS[vendor.status]}</Badge>
          ) : null}
        </div>
        {sample ? <p className={styles.muted}>{sample.summary}</p> : null}
        <dl className={styles.facts}>
          <div>
            <dt>Area:</dt>
            <dd>
              {sample
                ? sample.serviceAreas.join(', ')
                : (vendor?.serviceArea ?? 'Not recorded')}
            </dd>
          </div>
          <div>
            <dt>Capacity:</dt>
            <dd>
              {sample?.capacity
                ? `${sample.capacity.min ? `${sample.capacity.min} to ` : 'up to '}${sample.capacity.max} guests`
                : vendor?.capacityMax
                  ? `up to ${vendor.capacityMax} guests`
                  : 'Not stated'}
            </dd>
          </div>
          <div>
            <dt>{sample ? 'Illustrative price:' : 'Your quote:'}</dt>
            <dd>
              {sample
                ? `${priceText(sample.price)}${m.estimatePaise !== null ? ` (about ${formatMoney(m.estimatePaise)} for ${event.profile.guestCount} guests)` : ''}`
                : vendor?.quotePaise != null
                  ? formatMoney(vendor.quotePaise)
                  : 'None yet'}
            </dd>
          </div>
        </dl>
        <p>
          <strong>{m.summary}</strong>
        </p>
        <ul className={styles.checks} aria-label={`Checks for ${candidate.name}`}>
          {m.checks.map((c) => (
            <li key={`${c.criterion}-${c.capability ?? ''}`} data-outcome={c.outcome}>
              <span className="srOnly">{OUTCOME_WORDS[c.outcome]}: </span>
              {c.text}
            </li>
          ))}
        </ul>
        <div className={styles.buttons}>
          {sample && !vendor ? (
            <Button
              variant="secondary"
              icon={<Star aria-hidden size={16} />}
              aria-label={`Shortlist ${candidate.name}`}
              disabled={event.vendors.length >= LIMITS.vendors}
              onClick={() => {
                shortlist(m);
              }}
            >
              Shortlist
            </Button>
          ) : null}
          <Button
            variant={inCompare ? 'primary' : 'secondary'}
            icon={<GitCompare aria-hidden size={16} />}
            aria-pressed={inCompare}
            aria-label={`Compare ${candidate.name}`}
            onClick={() => {
              toggleCompare(candidate.key, candidate.name);
            }}
          >
            Compare
          </Button>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Vendors"
        description={`For ${event.profile.title}. Find, compare and keep track of vendors. Nothing here contacts or books anyone.`}
      />
      <Stack>
        <StatusMessage message={message?.text} tone={message?.tone ?? 'info'} />
        <p className={styles.note}>{SAMPLE_VENDOR_DISCLOSURE}</p>

        <Card
          title="What vendors must meet"
          description="Taken from your event details. A vendor that cannot do something you need is not suitable; one that has not said is marked Needs confirmation."
        >
          <ul>
            <li>
              {EVENT_TYPE_LABELS[requirements.eventType]} in {requirements.city}, for{' '}
              {requirements.guestCount} expected guests (venues and caterers must serve
              that many).
            </li>
            {kindsNeeding.length === 0 ? (
              <li>No special capabilities are required by your event details.</li>
            ) : (
              kindsNeeding.map((k) => (
                <li key={k}>
                  {VENDOR_KIND_LABELS[k]}:{' '}
                  {requirements.byKind[k]
                    .map(
                      (r) =>
                        `${CAPABILITY_LABELS[r.capability]} (${r.because.replace(/\.$/, '').toLowerCase()})`,
                    )
                    .join('; ')}
                  .
                </li>
              ))
            )}
          </ul>
          <details className={styles.excluded}>
            <summary>Require something else as well</summary>
            <CheckboxGroup
              name="extra-capabilities"
              legend="Also require, from every kind of vendor"
              options={CAPABILITY_OPTIONS}
              selected={extra}
              onChange={setExtra}
            />
          </details>
        </Card>

        <Card title="Find vendors">
          <div className={styles.filters}>
            <TextField
              name="vendor-search"
              label="Search"
              value={search}
              type="search"
              autoComplete="off"
              hint="Name, area, service or capability"
              onChange={setSearch}
            />
            <Select
              name="vendor-kind"
              label="Category"
              value={kind}
              options={KIND_OPTIONS}
              placeholder="All categories"
              onChange={setKind}
            />
          </div>
          <p className={styles.muted}>{counts}</p>
          {/* Announced once typing pauses, not on every key. */}
          <p className="srOnly" role="status" aria-live="polite">
            {settledCounts}
          </p>

          {suitable.length > 0 ? (
            <section className={styles.group} aria-labelledby="suitable-heading">
              <h3 id="suitable-heading">Suitable, ranked</h3>
              <ul className={styles.results}>{suitable.map(renderResult)}</ul>
            </section>
          ) : null}
          {confirm.length > 0 ? (
            <section className={styles.group} aria-labelledby="confirm-heading">
              <h3 id="confirm-heading">Needs confirmation</h3>
              <ul className={styles.results}>{confirm.map(renderResult)}</ul>
            </section>
          ) : null}
          {excluded.length > 0 ? (
            <section className={styles.group} aria-labelledby="excluded-heading">
              <h3 id="excluded-heading">Not suitable</h3>
              <details className={styles.excluded}>
                <summary>Show {excluded.length}, with reasons</summary>
                <ul className={styles.results}>{excluded.map(renderResult)}</ul>
              </details>
            </section>
          ) : null}
          {visible.length === 0 ? (
            <p className={styles.muted}>No vendors match this search.</p>
          ) : null}
        </Card>

        {compared.length > 0 ? (
          <CompareCard
            event={event}
            matches={compared}
            onRemove={(key, name) => {
              toggleCompare(key, name);
            }}
          />
        ) : null}

        <Card
          title="Your vendors"
          description="Shortlisted samples and vendors you added. Record contact, quotes, status and what you have checked."
        >
          {event.vendors.length === 0 ? (
            <p className={styles.muted}>No vendors on your list yet.</p>
          ) : (
            <ul className={styles.records}>
              {event.vendors.map((v) => (
                <VendorRecord
                  key={v.id}
                  event={event}
                  vendor={v}
                  sample={SAMPLE_VENDORS.find((s) => s.id === v.sampleId) ?? null}
                  requirements={requirements.byKind[v.kind]}
                  commit={commit}
                />
              ))}
            </ul>
          )}
        </Card>

        <AddVendorCard event={event} commit={commit} />
      </Stack>
    </>
  );
}

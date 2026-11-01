import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { VENDOR_STATUS_LABELS } from '@/data/labels.ts';
import { formatMoney } from '@/domain/money.ts';
import {
  CAPABILITY_LABELS,
  VENDOR_KIND_LABELS,
  priceText,
  type VendorMatch,
} from '@/domain/planning/vendors.ts';
import type { Capability, EventRecord } from '@/domain/types.ts';
import { MAX_COMPARE, OUTCOME_WORDS } from './vendorPresentation.ts';
import styles from './Vendors.module.css';

export function CompareCard({
  event,
  matches,
  onRemove,
}: {
  event: EventRecord;
  matches: readonly VendorMatch[];
  onRemove: (key: string, name: string) => void;
}) {
  const capabilities = [
    ...new Set(
      matches.flatMap((m) =>
        m.checks.flatMap((c) => (c.capability ? [c.capability] : [])),
      ),
    ),
  ];
  const cell = (m: VendorMatch, criterion: string, capability?: Capability) => {
    const check = m.checks.find(
      (c) =>
        c.criterion === criterion &&
        (capability === undefined || c.capability === capability),
    );
    return check ? `${OUTCOME_WORDS[check.outcome]}: ${check.text}` : 'Not relevant';
  };
  return (
    <Card
      title="Compare"
      description={`Up to ${MAX_COMPARE} vendors side by side. Sample prices are illustrative.`}
    >
      <div
        className={styles.tableWrap}
        role="region"
        aria-labelledby="compare-caption"
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption id="compare-caption">
            Comparison for {event.profile.guestCount} guests
          </caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              {matches.map((m) => (
                <th key={m.candidate.key} scope="col">
                  {m.candidate.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Source</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>
                  {m.candidate.sample ? 'Sample data (fictional)' : 'Your record'}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Category</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>{VENDOR_KIND_LABELS[m.candidate.kind]}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Match</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>{m.summary}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Service area</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>{cell(m, 'service-area')}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Capacity</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>{cell(m, 'capacity')}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Price</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>
                  {m.candidate.sample
                    ? `${priceText(m.candidate.sample.price)} (illustrative)`
                    : m.estimatePaise !== null
                      ? `${formatMoney(m.estimatePaise)} (your quote)`
                      : 'No quote yet'}
                </td>
              ))}
            </tr>
            {capabilities.map((c) => (
              <tr key={c}>
                <th scope="row">{CAPABILITY_LABELS[c]}</th>
                {matches.map((m) => (
                  <td key={m.candidate.key}>{cell(m, 'capability', c)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Your status</th>
              {matches.map((m) => (
                <td key={m.candidate.key}>
                  {m.candidate.vendor
                    ? VENDOR_STATUS_LABELS[m.candidate.vendor.status]
                    : 'Not on your list'}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">
                <span className="srOnly">Remove</span>
              </th>
              {matches.map((m) => (
                <td key={m.candidate.key}>
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${m.candidate.name} from the comparison`}
                    onClick={() => {
                      onRemove(m.candidate.key, m.candidate.name);
                    }}
                  >
                    Remove
                  </Button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

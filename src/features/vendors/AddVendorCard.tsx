import { Plus } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button.tsx';
import { Card } from '@/components/Card.tsx';
import { Select } from '@/components/Select.tsx';
import { TextField } from '@/components/TextField.tsx';
import { createId } from '@/domain/ids.ts';
import { LIMITS } from '@/domain/primitives.ts';
import type { ChangeOperation, EventRecord, VendorKind } from '@/domain/types.ts';
import { KIND_OPTIONS } from './vendorPresentation.ts';
import {
  parseVendorForm,
  VENDOR_FIELD_ORDER,
  VENDOR_FIELD_NAMES,
  type VendorFormErrors,
} from './vendorForm.ts';
import styles from './Vendors.module.css';

export function AddVendorCard({
  event,
  commit,
}: {
  event: EventRecord;
  commit: (operations: readonly ChangeOperation[], success: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<VendorKind | ''>('');
  const [contact, setContact] = useState('');
  const [serviceArea, setServiceArea] = useState('');
  const [capacity, setCapacity] = useState('');
  const [errors, setErrors] = useState<VendorFormErrors>({});
  const addButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Focus after React mounts the destination, without a timer or a lost tab position.
  useLayoutEffect(() => {
    if (open) {
      document.getElementById('field-new-vendor-name')?.focus();
    } else if (wasOpen.current) {
      addButton.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const result = parseVendorForm(
      { name, kind, contact, serviceArea, capacity },
      createId('vendor'),
    );
    if (!result.ok) {
      setErrors(result.errors);
      const first = VENDOR_FIELD_ORDER.find((field) => result.errors[field]);
      if (first) document.getElementById(`field-${VENDOR_FIELD_NAMES[first]}`)?.focus();
      return;
    }
    const vendor = result.vendor;
    if (
      commit(
        [{ op: 'vendors/upsert', item: vendor }],
        `Added ${vendor.name} to your vendors.`,
      )
    ) {
      setOpen(false);
      setName('');
      setKind('');
      setContact('');
      setServiceArea('');
      setCapacity('');
      setErrors({});
    }
  };

  return (
    <Card
      title="Add a vendor you found"
      description="Your own record. Anything you leave blank is treated as not known yet."
      actions={
        open ? null : (
          <Button
            ref={addButton}
            icon={<Plus aria-hidden size={18} />}
            disabled={event.vendors.length >= LIMITS.vendors}
            onClick={() => {
              setOpen(true);
            }}
          >
            Add vendor
          </Button>
        )
      }
    >
      {open ? (
        <form
          className={styles.form}
          onSubmit={submit}
          noValidate
          aria-label="Add a vendor"
        >
          <TextField
            name="new-vendor-name"
            label="Vendor name"
            value={name}
            maxLength={100}
            required
            autoComplete="off"
            error={errors.name}
            onChange={(v) => {
              setName(v);
              setErrors((e) => ({ ...e, name: undefined }));
            }}
          />
          <Select
            name="new-vendor-kind"
            label="Category"
            value={kind}
            options={KIND_OPTIONS}
            placeholder="Choose a category"
            required
            error={errors.kind}
            onChange={(v) => {
              setKind(v);
              setErrors((e) => ({ ...e, kind: undefined }));
            }}
          />
          <TextField
            name="new-vendor-area"
            label="Service area (optional)"
            value={serviceArea}
            maxLength={100}
            autoComplete="off"
            error={errors.serviceArea}
            onChange={(value) => {
              setServiceArea(value);
              setErrors((current) => ({ ...current, serviceArea: undefined }));
            }}
          />
          <TextField
            name="new-vendor-capacity"
            label="Most guests they can serve (optional)"
            value={capacity}
            inputMode="numeric"
            error={errors.capacity}
            onChange={(v) => {
              setCapacity(v);
              setErrors((e) => ({ ...e, capacity: undefined }));
            }}
          />
          <TextField
            name="new-vendor-contact"
            label="Contact (optional, your note)"
            value={contact}
            maxLength={120}
            autoComplete="off"
            error={errors.contact}
            onChange={(value) => {
              setContact(value);
              setErrors((current) => ({ ...current, contact: undefined }));
            }}
          />
          <div className={`${styles.buttons} ${styles.wide}`}>
            <Button type="submit">Save vendor</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

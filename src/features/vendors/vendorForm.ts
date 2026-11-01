import { vendorSchema } from '@/domain/schemas.ts';
import type { Vendor, VendorKind } from '@/domain/types.ts';

export interface VendorFormValues {
  name: string;
  kind: VendorKind | '';
  serviceArea: string;
  capacity: string;
  contact: string;
}

export type VendorFormErrors = Partial<
  Record<keyof VendorFormValues, string | undefined>
>;

/** Display order also determines which invalid field receives keyboard focus. */
export const VENDOR_FIELD_ORDER = [
  'name',
  'kind',
  'serviceArea',
  'capacity',
  'contact',
] as const;
export const VENDOR_FIELD_NAMES = {
  name: 'new-vendor-name',
  kind: 'new-vendor-kind',
  serviceArea: 'new-vendor-area',
  capacity: 'new-vendor-capacity',
  contact: 'new-vendor-contact',
} satisfies Record<keyof VendorFormValues, string>;

type VendorFormResult =
  { ok: true; vendor: Vendor } | { ok: false; errors: VendorFormErrors };

/** Validate every user-editable field before dispatching a change to the event. */
export function parseVendorForm(values: VendorFormValues, id: string): VendorFormResult {
  const errors: VendorFormErrors = {};
  if (!values.kind) errors.kind = 'Choose a category';
  const capacity = values.capacity.trim();
  if (capacity && !/^\d+$/.test(capacity)) {
    errors.capacity = 'Enter a whole number of guests, like 150';
  }
  const parsed = vendorSchema.safeParse({
    id,
    name: values.name,
    kind: values.kind || 'other',
    status: 'shortlisted',
    quotePaise: null,
    ...(values.contact.trim() ? { contact: values.contact.trim() } : {}),
    ...(values.serviceArea.trim() ? { serviceArea: values.serviceArea.trim() } : {}),
    ...(capacity && !errors.capacity ? { capacityMax: Number(capacity) } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === 'capacityMax' ? 'capacity' : issue.path[0];
      const field = VENDOR_FIELD_ORDER.find((field) => field === key);
      if (field) errors[field] ??= issue.message;
      else errors.name ??= 'This vendor could not be saved. Please try again.';
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, vendor: parsed.data };
}

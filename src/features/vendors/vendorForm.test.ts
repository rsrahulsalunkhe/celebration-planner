import { describe, expect, it } from 'vitest';
import { parseVendorForm, type VendorFormValues } from './vendorForm.ts';

const valid: VendorFormValues = {
  name: ' Local hall ',
  kind: 'venue',
  serviceArea: '',
  capacity: '',
  contact: '',
};

describe('vendor form validation', () => {
  it('trims text and leaves unknown optional details absent', () => {
    expect(parseVendorForm(valid, 'vendor-1')).toEqual({
      ok: true,
      vendor: {
        id: 'vendor-1',
        name: 'Local hall',
        kind: 'venue',
        status: 'shortlisted',
        quotePaise: null,
      },
    });
  });

  it.each(['0', '-1', '1.5', '1e3', '50001', '999999999999999999999999'])(
    'rejects invalid capacity %s instead of saving or rounding it',
    (capacity) => {
      const result = parseVendorForm({ ...valid, capacity }, 'vendor-1');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Invalid capacity was accepted');
      expect(result.errors.capacity).toBeTypeOf('string');
    },
  );

  it('accepts the capacity boundary and normalizes optional details', () => {
    expect(
      parseVendorForm(
        { ...valid, capacity: ' 50000 ', contact: ' Office ', serviceArea: ' Pune ' },
        'vendor-1',
      ),
    ).toMatchObject({
      ok: true,
      vendor: { capacityMax: 50000, contact: 'Office', serviceArea: 'Pune' },
    });
  });

  it('returns all field errors together, including optional text', () => {
    const result = parseVendorForm(
      {
        name: '',
        kind: '',
        capacity: '1.5',
        contact: 'bad\u0007text',
        serviceArea: 'x'.repeat(101),
      },
      'vendor-1',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Invalid vendor was accepted');
    expect(Object.keys(result.errors).sort()).toEqual([
      'capacity',
      'contact',
      'kind',
      'name',
      'serviceArea',
    ]);
    for (const message of Object.values(result.errors)) {
      expect(message).toBeTypeOf('string');
      expect(message?.length).toBeGreaterThan(0);
    }
  });
});

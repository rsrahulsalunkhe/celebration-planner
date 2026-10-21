import type { CelebrationEvent } from '@/domain/types.ts';

// Fictional sample data only. Amounts are in minor units: 150,000,000 paise = ₹15,00,000.
export const sampleWedding: CelebrationEvent = {
  id: 'sample-wedding',
  name: 'Meera & Arjun’s Wedding',
  type: 'wedding',
  date: '2027-02-13',
  guestCount: 180,
  budget: 150_000_000,
  currency: 'INR',
  city: 'Pune',
  notes: 'Fictional example event used to explore the planner.',
};

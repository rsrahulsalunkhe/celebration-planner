import type { EventType } from '@/domain/types.ts';

/**
 * Catalog of plan building blocks. Each template has a permanent id: generated
 * items derive their own ids from it (see `generatedId`), so regenerating a
 * plan updates the same items instead of duplicating them. Never rename an id.
 *
 * Amounts, weights and due-date offsets belong to the plan generator and are
 * added to its rule configuration in a later stage.
 */

const ALL: readonly EventType[] = ['wedding', 'birthday', 'community'];

export interface CategoryTemplate {
  id: string;
  name: string;
  appliesTo: readonly EventType[];
}

export interface ExpenseTemplate {
  id: string;
  categoryTemplateId: string;
  name: string;
  appliesTo: readonly EventType[];
}

export interface TaskTemplate {
  id: string;
  title: string;
  appliesTo: readonly EventType[];
}

export const CATEGORY_TEMPLATES: readonly CategoryTemplate[] = [
  { id: 'category.venue', name: 'Venue', appliesTo: ALL },
  { id: 'category.food', name: 'Food and drink', appliesTo: ALL },
  { id: 'category.decor', name: 'Decor and setup', appliesTo: ALL },
  {
    id: 'category.media',
    name: 'Photography and video',
    appliesTo: ['wedding', 'birthday'],
  },
  { id: 'category.entertainment', name: 'Entertainment', appliesTo: ALL },
  { id: 'category.attire', name: 'Attire and styling', appliesTo: ['wedding'] },
  { id: 'category.access', name: 'Accessibility and comfort', appliesTo: ALL },
  { id: 'category.contingency', name: 'Contingency', appliesTo: ALL },
];

export const EXPENSE_TEMPLATES: readonly ExpenseTemplate[] = [
  {
    id: 'expense.venue-hire',
    categoryTemplateId: 'category.venue',
    name: 'Venue hire',
    appliesTo: ALL,
  },
  {
    id: 'expense.catering',
    categoryTemplateId: 'category.food',
    name: 'Catering',
    appliesTo: ALL,
  },
  {
    id: 'expense.beverages',
    categoryTemplateId: 'category.food',
    name: 'Beverages',
    appliesTo: ALL,
  },
  {
    id: 'expense.decor',
    categoryTemplateId: 'category.decor',
    name: 'Decor and flowers',
    appliesTo: ALL,
  },
  {
    id: 'expense.photographer',
    categoryTemplateId: 'category.media',
    name: 'Photographer',
    appliesTo: ['wedding', 'birthday'],
  },
  {
    id: 'expense.music',
    categoryTemplateId: 'category.entertainment',
    name: 'Music or DJ',
    appliesTo: ALL,
  },
  {
    id: 'expense.attire',
    categoryTemplateId: 'category.attire',
    name: 'Outfits and styling',
    appliesTo: ['wedding'],
  },
  {
    id: 'expense.ramps-seating',
    categoryTemplateId: 'category.access',
    name: 'Ramps, seating and shade',
    appliesTo: ALL,
  },
  {
    id: 'expense.contingency',
    categoryTemplateId: 'category.contingency',
    name: 'Contingency reserve',
    appliesTo: ALL,
  },
];

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  { id: 'task.set-budget', title: 'Confirm the total budget', appliesTo: ALL },
  { id: 'task.book-venue', title: 'Shortlist and book the venue', appliesTo: ALL },
  { id: 'task.guest-list', title: 'Draft the guest list', appliesTo: ALL },
  { id: 'task.book-caterer', title: 'Choose and book catering', appliesTo: ALL },
  {
    id: 'task.book-photographer',
    title: 'Book a photographer',
    appliesTo: ['wedding', 'birthday'],
  },
  { id: 'task.send-invites', title: 'Send invitations', appliesTo: ALL },
  {
    id: 'task.check-access',
    title: 'Check access routes, seating and restrooms',
    appliesTo: ALL,
  },
  {
    id: 'task.weather-plan',
    title: 'Prepare a weather backup plan',
    appliesTo: ['community', 'wedding'],
  },
  {
    id: 'task.volunteer-roster',
    title: 'Build the volunteer roster',
    appliesTo: ['community'],
  },
  {
    id: 'task.permissions',
    title: 'Check venue or local permissions',
    appliesTo: ['community', 'wedding'],
  },
  {
    id: 'task.confirm-rsvps',
    title: 'Confirm RSVPs and final headcount',
    appliesTo: ALL,
  },
  {
    id: 'task.final-walkthrough',
    title: 'Walk through the plan with vendors',
    appliesTo: ALL,
  },
];

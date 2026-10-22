import type { DietaryNeed, EventType } from '@/domain/types.ts';

/**
 * Food ideas the guided planner can draft from. Each lists the dietary needs
 * it can suit when prepared that way; the organizer still checks every dish
 * with whoever cooks it.
 */
export interface FoodIdea {
  title: string;
  details: string;
  suits: readonly DietaryNeed[];
  eventTypes: readonly EventType[];
}

export const FOOD_IDEAS: readonly FoodIdea[] = [
  {
    title: 'Chaat counter',
    details: 'Pani puri, bhel and sev puri made to order; easy to keep fully vegetarian.',
    suits: ['vegetarian', 'jain'],
    eventTypes: ['birthday', 'wedding', 'community'],
  },
  {
    title: 'Build-your-own mini pizzas',
    details:
      'Small bases with vegetable toppings that guests choose themselves; popular with children.',
    suits: ['vegetarian'],
    eventTypes: ['birthday'],
  },
  {
    title: 'Paneer and vegetable skewers',
    details:
      'Grilled or baked, served with mint chutney. Swap paneer for tofu to make them vegan.',
    suits: ['vegetarian', 'vegan', 'gluten-free'],
    eventTypes: ['birthday', 'wedding'],
  },
  {
    title: 'Fruit and coconut-milk desserts',
    details: 'Fruit platters and coconut-milk kheer avoid dairy and suit vegan guests.',
    suits: ['vegetarian', 'vegan', 'dairy-free', 'gluten-free'],
    eventTypes: ['birthday', 'wedding', 'community'],
  },
  {
    title: 'Mini thali',
    details:
      'A small plate of dal, a vegetable, rice and a sweet, so every guest gets a full meal.',
    suits: ['vegetarian', 'jain'],
    eventTypes: ['wedding', 'community', 'birthday'],
  },
  {
    title: 'Bring-a-dish table',
    details:
      'Neighbours bring a labelled vegetarian dish; label cards list the main ingredients.',
    suits: ['vegetarian'],
    eventTypes: ['community'],
  },
  {
    title: 'Millet laddoos and roasted chana',
    details: 'Low-sugar snacks that keep well outdoors.',
    suits: ['vegetarian', 'vegan', 'diabetic-friendly', 'gluten-free'],
    eventTypes: ['birthday', 'community'],
  },
];

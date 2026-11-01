export type Choice = 'drift' | 'not_drift';

const FLICK_VELOCITY = 800;
const MIN_FLICK_DISTANCE = 40;

// Right means drift, left means not drift. A drag past a third of the card counts,
// and so does a fast flick that has moved a little. Anything shorter springs back.
export function swipeOutcome(translationX: number, velocityX: number, width: number): Choice | null {
  'worklet';
  if (width <= 0) return null;
  const threshold = width / 3;
  if (translationX > threshold) return 'drift';
  if (translationX < -threshold) return 'not_drift';
  if (velocityX > FLICK_VELOCITY && translationX > MIN_FLICK_DISTANCE) return 'drift';
  if (velocityX < -FLICK_VELOCITY && translationX < -MIN_FLICK_DISTANCE) return 'not_drift';
  return null;
}

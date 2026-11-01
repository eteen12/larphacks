import { swipeOutcome } from '@/lib/swipe';

describe('swipeOutcome', () => {
  it('chooses drift when dragged right past a third of the width', () => {
    expect(swipeOutcome(150, 0, 300)).toBe('drift');
  });

  it('chooses not drift when dragged left past a third of the width', () => {
    expect(swipeOutcome(-150, 0, 300)).toBe('not_drift');
  });

  it('springs back on a short, slow drag', () => {
    expect(swipeOutcome(60, 100, 300)).toBeNull();
    expect(swipeOutcome(-60, -100, 300)).toBeNull();
  });

  it('counts a fast flick that moved a little', () => {
    expect(swipeOutcome(60, 1200, 300)).toBe('drift');
    expect(swipeOutcome(-60, -1200, 300)).toBe('not_drift');
  });

  it('ignores a fast flick that barely moved', () => {
    expect(swipeOutcome(10, 1200, 300)).toBeNull();
  });

  it('ignores a flick against the drag direction', () => {
    expect(swipeOutcome(-60, 1200, 300)).toBeNull();
  });

  it('chooses nothing before the card has a width', () => {
    expect(swipeOutcome(500, 0, 0)).toBeNull();
  });
});

import { useEffect, useState } from 'react';

/**
 * The value once it has stopped changing for `ms`. For live regions that
 * follow typing, so a result count is announced once, not on every key.
 */
export function useSettled<T>(value: T, ms = 600): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

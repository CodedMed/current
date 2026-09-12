import { useEffect, useRef, useState } from 'react';

/** Tracks the rendered width of an element so SVG charts can lay out in pixels. */
export function useElementWidth<T extends HTMLElement>(initial = 320): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width || initial);
    return () => observer.disconnect();
  }, [initial]);
  return [ref, width];
}

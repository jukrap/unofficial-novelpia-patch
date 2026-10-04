import { animateElement } from './motion';

export function animateBook(element: SVGElement) {
  return animateElement(
    element,
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0.45, transform: 'translateY(-2px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    { duration: 1700, iterations: Infinity, easing: 'ease-in-out' }
  );
}

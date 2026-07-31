/**
 * Shared framer-motion variants. Durations stay within the 150–250ms
 * band mandated by §9.18 — subtle fade/scale/slide only.
 */

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

export const fadeInUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};

export function stagger(delay: number) {
  return {
    hidden: { opacity: 0, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { staggerChildren: delay, delayChildren: 0.1 },
    },
  };
}

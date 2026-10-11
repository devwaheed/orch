import { iconPaths, filledIcons, type IconName } from './icons';

type Props = {
  name: IconName;
  /** Pixel size; the design uses 11–19. */
  size?: number;
  /** Stroke width; the design uses 1.8–2.6 (heavier at small sizes). */
  weight?: number;
  /** Accessible label. Omit for decorative icons next to visible text. */
  label?: string;
  className?: string;
};

export function Icon({ name, size = 16, weight = 1.9, label, className }: Props) {
  const filled = filledIcons.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

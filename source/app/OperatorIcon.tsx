import { operatorIconSheet } from "./operator-data";
import type { OperatorAsset } from "./operator-data";

type OperatorIconProps = {
  alt?: string;
  className?: string;
  operator: OperatorAsset;
  size: number;
  detailed?: boolean;
};

export function OperatorIcon({ alt = "", className, operator, size, detailed = false }: OperatorIconProps) {
  if (!operator.sprite) {
    return (
      <img
        alt={alt}
        decoding="async"
        height={size}
        src={operator.icon}
        width={size}
      />
    );
  }

  const backgroundPositionX = operator.sprite.column === 0
    ? "0%"
    : `${(operator.sprite.column / 6) * 100}%`;
  const backgroundPositionY = operator.sprite.row === 0
    ? "0%"
    : `${(operator.sprite.row / 10) * 100}%`;

  return (
    <span
      aria-hidden={alt ? undefined : true}
      aria-label={alt || undefined}
      className={className ? `operator-sprite ${className}` : "operator-sprite"}
      role={alt ? "img" : undefined}
      style={{
        backgroundImage: `url("${detailed ? operator.icon : operatorIconSheet}")`,
        backgroundPosition: detailed ? "center" : `${backgroundPositionX} ${backgroundPositionY}`,
        ...(detailed ? {backgroundSize:"contain"} : {}),
        height: size,
        width: size,
      }}
    />
  );
}

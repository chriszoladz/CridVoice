import markDark from "./assets/branding/mark-dark.png";
import markLight from "./assets/branding/mark-light.png";
import lockupDark from "./assets/branding/lockup-dark.png";
import lockupLight from "./assets/branding/lockup-light.png";

type BrandMarkProps = {
  className?: string;
  size?: number;
  title?: string;
};

export function BrandMark({
  className = "brand-mark",
  size = 38,
  title,
}: BrandMarkProps) {
  return (
    <span
      className={className}
      style={{ width: size, height: size }}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
    >
      <img
        className="brand-image-dark"
        src={markDark}
        alt=""
        draggable={false}
      />
      <img
        className="brand-image-light"
        src={markLight}
        alt=""
        draggable={false}
      />
    </span>
  );
}

export function BrandLockup({
  className = "brand-lockup",
  title,
}: Pick<BrandMarkProps, "className" | "title">) {
  return (
    <span
      className={className}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      role={title ? "img" : undefined}
    >
      <img
        className="brand-image-dark"
        src={lockupDark}
        alt=""
        draggable={false}
      />
      <img
        className="brand-image-light"
        src={lockupLight}
        alt=""
        draggable={false}
      />
    </span>
  );
}

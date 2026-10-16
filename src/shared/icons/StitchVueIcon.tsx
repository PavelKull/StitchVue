import { getStitchVueIcon, type StitchVueIconName } from "./stitchvue-icons";

type StitchVueIconProps = {
  name: StitchVueIconName;
  className?: string;
  title?: string;
  rotate?: number;
};

export function StitchVueIcon({ name, className, title, rotate }: StitchVueIconProps) {
  const svg = getStitchVueIcon(name);
  const style = rotate ? { display: "inline-flex", transform: `rotate(${rotate}deg)` } : undefined;
  return (
    <span
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

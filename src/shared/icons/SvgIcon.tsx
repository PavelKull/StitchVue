import driveSvg from "./stitchvue-icons/drive.svg?raw";
import folderSvg from "./stitchvue-icons/folder.svg?raw";
import imageSvg from "./stitchvue-icons/file-image.svg?raw";

type SvgIconProps = {
  svg: string;
  className?: string;
};

function SvgIcon({ svg, className }: SvgIconProps) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function FolderIcon({ className }: { className?: string }) {
  return <SvgIcon svg={folderSvg} className={className} />;
}

export function DriveIcon({ className }: { className?: string }) {
  return <SvgIcon svg={driveSvg} className={className} />;
}

export function ImageIcon({ className }: { className?: string }) {
  return <SvgIcon svg={imageSvg} className={className} />;
}

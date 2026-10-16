import type { StitchVueIconName } from "../../../../shared/icons/stitchvue-icons";

/** Maps a drive media tag to a device icon. Unknown and HDD share the disk icon. */
export function driveIconName(media: string | null | undefined): StitchVueIconName {
  switch (media) {
    case "ssd":
      return "drive-ssd";
    case "removable":
      return "drive-removable";
    case "nas":
      return "drive-nas";
    case "optical":
      return "drive-optical";
    case "camera":
      return "drive-camera";
    case "mobile":
      return "drive-mobile";
    case "sd":
      return "drive-sd";
    case "bluetooth":
      return "drive-bluetooth";
    default:
      return "drive";
  }
}

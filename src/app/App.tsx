import { GalleryPage } from "../pages/gallery/GalleryPage";
import { useDisableNativeContextMenu } from "../shared/hooks/useDisableNativeContextMenu";

export function App() {
  useDisableNativeContextMenu();
  return <GalleryPage />;
}

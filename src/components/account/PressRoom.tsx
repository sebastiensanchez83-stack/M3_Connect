import { MediaArticles } from '@/components/media/MediaArticles';
import { MediaPressRoom } from '@/components/media/MediaPressRoom';

/** The press room block: the media kits and press materials, then the articles (the old /account?tab=press). */
export function PressRoom() {
  return (
    <div className="space-y-6">
      <MediaPressRoom />
      <MediaArticles />
    </div>
  );
}

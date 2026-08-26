export type StudioPost = {
  id: string;
  instagramMediaId: string;
  mediaType: string;
  caption?: string | null;
  permalink?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  timestamp: string;
  automations?: Array<{
    id: string;
    name: string;
    status: string;
    keywords?: string[];
    dmMessageTemplate?: string;
  }>;
};

export function postCover(post?: Partial<StudioPost> | null) {
  return post?.thumbnailUrl || post?.mediaUrl || '';
}

export function postTitle(post: StudioPost) {
  const caption = (post.caption || '').trim();
  if (!caption) return post.mediaType === 'REEL' ? 'Reel' : 'Post';
  return caption.length > 90 ? `${caption.slice(0, 90)}…` : caption;
}

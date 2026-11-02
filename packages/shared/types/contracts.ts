/** Public API contracts. No Telegram credentials, access hashes or private routes. */
export interface Video {
  id: string;
  title: string;
  titleUnverified?: boolean;
  description?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  durationSeconds: number | null;
  artwork: string | null;
}
export type Sort = 'latest' | 'most-viewed' | 'longest' | 'oldest';
export type Period = 'day' | 'week' | 'month';
export interface Catalogue {
  items: Video[];
  capabilities: {viewRanking: boolean; durationSorting?: boolean; comments: boolean};
  total?: number;
  nextCursor?: string | null;
  source?: 'postgresql' | 'telegram-sync' | 'local-manual-selection';
  sync?: {initialComplete: boolean; [key: string]: unknown} | null;
}
export interface Trending {available: true; period: Period; items: Video[];}
export interface Unavailable {available: false; code: 'NOT_IMPLEMENTED'; message: string; items: [];}
export interface Comment {id:string; author:{id:string;displayName:string}; body:string;createdAt:string;}
export interface Comments {available:true;items:Comment[];total:number;nextOffset:number|null;}
export interface NewComment {body:string;}
export interface PlaybackProgress {videoId:string;position:number;completed:boolean;lastWatched:string;}
export interface Account {id:string;username:string;displayName:string|null;status:'ACTIVE'|'SUSPENDED';createdAt:string;}
export interface MembershipPlan {id:string;name:string;durationMonths:number;priceMinor:number;currency:string;active:boolean;sortOrder:number;}
export interface Membership {id:string;planName:string;activatedAt:string;expiresAt:string;revokedAt:string|null;status:'ACTIVE'|'EXPIRED'|'REVOKED';}
export interface SubscriptionRequest {
  id:string;reference:string;username:string;planId:string;planName:string;
  durationMonths:number;amountMinor:number;currency:string;
  status:'PENDING'|'APPROVED'|'REJECTED'|'CANCELLED';createdAt:string;
  handoff:{supportUsername:string|null;url:string|null;message:string;manualSendRequired:true};
}

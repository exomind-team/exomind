import { NowPage } from './NowPage';
import { LocalProfileGuard } from '@/ui/app/components/LocalProfileGuard';

export function FocusPage() {
  return <LocalProfileGuard><NowPage /></LocalProfileGuard>;
}

import { Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FocusKeepAwakeControl } from './FocusKeepAwakeController';

interface FocusKeepAwakeButtonProps {
  control: FocusKeepAwakeControl;
}

export function FocusKeepAwakeButton({ control }: FocusKeepAwakeButtonProps) {
  const className = control.available
    ? control.enabled
      ? 'h-9 w-9 rounded-[10px] border border-[#F3C3B7] bg-[#FDE6DF] p-0 text-[#C75B3A] hover:bg-[#F8D8CE] dark:border-[#7A3A2A] dark:bg-[#442019] dark:text-[#F39A7C]'
      : 'h-9 w-9 rounded-[10px] border border-[#E7E5E4] bg-white/50 p-0 text-[#8C7D78] hover:bg-white/70 hover:text-[#C75B3A] dark:border-[#FFFFFF20] dark:bg-[#FFFFFF10] dark:text-[#D6D3D1] dark:hover:text-[#F39A7C]'
    : 'h-9 w-9 rounded-[10px] border border-[#E7E5E4] bg-white/30 p-0 text-[#B4ADA9] opacity-70 dark:border-[#FFFFFF14] dark:bg-[#FFFFFF08] dark:text-[#78716C]';

  return (
    <Button
      type="button"
      variant="ghost"
      data-testid="new-focus-keep-awake-button"
      aria-label={control.ariaLabel}
      aria-pressed={control.enabled}
      title={control.buttonTitle}
      disabled={!control.available || control.pending}
      onClick={control.onToggle}
      className={className}
    >
      <Sun size={16} />
    </Button>
  );
}

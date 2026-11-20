import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

type TooltipProps = Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>, 'asChild' | 'children' | 'content'> & {
  content?: string;
  children: React.ReactElement<{ title?: string }>;
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  delayDuration?: number;
};

/** A themed, portalled hint with no layout wrapper or native title. Forward
 * trigger props/ref so composition with DialogTrigger asChild remains intact.
 * https://www.radix-ui.com/primitives/docs/components/tooltip */
export const Tooltip = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Trigger>, TooltipProps>(
  ({ content, children, side = 'top', delayDuration = 350, className, ...triggerProps }, ref) => {
    const [open, setOpen] = React.useState(false);
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    return <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root open={hasContent && open} onOpenChange={next => setOpen(hasContent && next)}>
        <TooltipPrimitive.Trigger {...triggerProps} ref={ref} asChild title={undefined}
          className={cn('focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring', className)}>
          {React.cloneElement(children, { title: undefined })}
        </TooltipPrimitive.Trigger>
        {hasContent && <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} sideOffset={6} collisionPadding={8}
            className="z-[100] max-w-[min(22rem,var(--radix-tooltip-content-available-width))] break-words rounded-lg border border-border-card bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>;
  },
);
Tooltip.displayName = 'Tooltip';

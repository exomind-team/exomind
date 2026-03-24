import type { ReactNode } from 'react';

export function SettingsItemRow({
  label,
  description,
  control,
  onClick,
  testId,
}: {
  label: string;
  description?: string;
  control?: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const content = (
    <>
      <div className="min-w-0 text-left">
        <div className="text-sm text-[#1C1917] dark:text-[#FAFAF9]">{label}</div>
        {description ? (
          <div className="mt-1 text-xs text-[#A8A29E]">{description}</div>
        ) : null}
      </div>
      {control ? <div className="ml-3 flex shrink-0 items-center">{control}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        data-testid={testId}
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 px-4 py-[14px] text-left"
      >
        {content}
      </button>
    );
  }

  return (
    <div data-testid={testId} className="flex w-full items-center justify-between gap-3 px-4 py-[14px]">
      {content}
    </div>
  );
}

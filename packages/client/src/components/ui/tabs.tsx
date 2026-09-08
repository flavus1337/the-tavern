import {
  createContext,
  useContext,
  useId,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { cn } from '../../lib/utils';

interface TabsContextValue {
  id: string;
  active: string;
  setActive: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used inside <Tabs>');
  return ctx;
}

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const id = useId();
  return (
    <TabsContext.Provider value={{ id, active: value, setActive: onValueChange }}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  label?: string;
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className, label = 'Sections' }: TabsListProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex shrink-0 gap-0.5 overflow-x-auto px-[14px] pt-3 border-b border-[var(--border-soft)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const { id, active, setActive } = useTabsContext();
  const isActive = active === value;

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (moveTabFocus(e)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActive(value);
    }
  };

  return (
    <button
      type="button"
      role="tab"
      id={`${id}-tab-${value}`}
      aria-controls={`${id}-panel-${value}`}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => setActive(value)}
      onFocus={() => setActive(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex-1 shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 px-3 pb-3 pt-0 text-[13px] font-semibold relative transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ember)]',
        isActive
          ? 'text-[var(--ember)] after:absolute after:left-3 after:right-3 after:bottom-[-1px] after:h-[2px] after:bg-[var(--ember)] after:rounded-sm'
          : 'text-[var(--low)] hover:text-[var(--mid)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { id, active } = useTabsContext();
  return (
    <div role="tabpanel" id={`${id}-panel-${value}`} aria-labelledby={`${id}-tab-${value}`}
      hidden={active !== value} tabIndex={0} className={cn('flex-1 min-h-0', className)}>
      {active === value ? children : null}
    </div>
  );
}

/** Only siblings in the current tablist participate, including inside nested tabs. */
export function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
  const current = event.currentTarget;
  const list = current.closest('[role="tablist"]');
  if (!list) return false;
  const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .filter((tab) => !tab.disabled && tab.closest('[role="tablist"]') === list);
  const index = tabs.indexOf(current);
  if (index < 0 || !tabs.length) return false;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  return true;
}

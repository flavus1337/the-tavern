import {
  createContext,
  useContext,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { cn } from '../../lib/utils';

interface TabsContextValue {
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
  return (
    <TabsContext.Provider value={{ active: value, setActive: onValueChange }}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex gap-0.5 px-[14px] pt-3 border-b border-[var(--border-soft)]',
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
  const { active, setActive } = useTabsContext();
  const isActive = active === value;

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActive(value);
    }
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => setActive(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 pb-3 pt-0 text-[13px] font-semibold relative transition-colors',
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
  const { active } = useTabsContext();
  if (active !== value) return null;
  return (
    <div role="tabpanel" className={cn('flex-1 min-h-0', className)}>
      {children}
    </div>
  );
}

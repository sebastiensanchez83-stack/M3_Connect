import * as React from "react"

interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

interface CollapsibleTriggerProps {
  children: React.ReactNode;
  className?: string;
  asChild?: boolean;
}

interface CollapsibleContentProps {
  children: React.ReactNode;
  className?: string;
}

const CollapsibleContext = React.createContext<{
  open: boolean;
  toggle: () => void;
}>({ open: false, toggle: () => {} });

function Collapsible({ open, onOpenChange, children, className }: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const toggle = React.useCallback(() => {
    if (isControlled) {
      onOpenChange?.(!open);
    } else {
      setInternalOpen((prev) => {
        const next = !prev;
        onOpenChange?.(next);
        return next;
      });
    }
  }, [isControlled, open, onOpenChange]);

  return (
    <CollapsibleContext.Provider value={{ open: isOpen, toggle }}>
      <div className={className} data-state={isOpen ? "open" : "closed"}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

function CollapsibleTrigger({ children, className }: CollapsibleTriggerProps) {
  const { toggle } = React.useContext(CollapsibleContext);
  return (
    <button type="button" onClick={toggle} className={className}>
      {children}
    </button>
  );
}

function CollapsibleContent({ children, className }: CollapsibleContentProps) {
  const { open } = React.useContext(CollapsibleContext);
  if (!open) return null;
  return <div className={className}>{children}</div>;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

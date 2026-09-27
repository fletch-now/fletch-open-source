// Optional shadcn-style composition, with Radix behavior and plain token CSS.
// Read before use. These controls do not replace fletch/wallet.tsx.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import './components.css';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  function DialogContent({ className = '', children, ...props }, ref) {
    return <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fletch-dialog-overlay" />
      <DialogPrimitive.Content ref={ref} className={`fletch-dialog-content ${className}`} {...props}>
        {children}
        <DialogPrimitive.Close className="fletch-dialog-close" aria-label="Close dialog">×</DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>;
  },
);
export const Tabs = TabsPrimitive.Root;
export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  function TabsList({ className = '', ...props }, ref) { return <TabsPrimitive.List ref={ref} className={`fletch-tabs-list ${className}`} {...props} />; },
);
export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  function TabsTrigger({ className = '', ...props }, ref) { return <TabsPrimitive.Trigger ref={ref} className={`fletch-tabs-trigger ${className}`} {...props} />; },
);
export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  function TabsContent({ className = '', ...props }, ref) { return <TabsPrimitive.Content ref={ref} className={`fletch-tabs-content ${className}`} {...props} />; },
);

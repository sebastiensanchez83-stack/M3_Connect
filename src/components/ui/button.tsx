import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * The shadcn Button, used everywhere (admin, account, SM26 consoles): the
 * original variants and sizes are unchanged.
 *
 * Refonte (Oct 2026) adds the "marée" (tide) family, for the public pages:
 * on hover / keyboard focus a fill rises from the bottom with a wavy, drifting
 * top edge (0.5 s), the text changes colour as the water passes it, and a
 * trailing arrow icon nudges 3 px. Pill shaped, 48 px by default.
 *   tide             gold, navy text, navy water  — THE main action (one per screen), on light backgrounds
 *   tideOnDark       gold, navy text, WHITE water — the same main action on navy or a photo
 *                    (navy water on a navy band would make the button vanish on hover/focus)
 *   tideNavy         navy, white text, gold water — secondary
 *   tideOutline      1.5 px navy border, navy water — tertiary on light
 *   tideLight        white, navy text, gold water — on photos and navy panels
 *   tideOutlineLight white border on dark, white water
 * The wave itself lives in src/styles/smc-motion.css (.tide), driven by the
 * --tide-fill and --tide-fg-hover variables set here.
 */
const TIDE_VARIANTS = ["tide", "tideOnDark", "tideNavy", "tideOutline", "tideLight", "tideOutlineLight"] as const

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        tide:
          "tide bg-gold text-navy font-semibold [--tide-fill:rgb(11_38_83)] [--tide-fg-hover:#ffffff]",
        tideOnDark:
          "tide bg-gold text-navy font-semibold [--tide-fill:#ffffff] [--tide-fg-hover:rgb(11_38_83)]",
        tideNavy:
          "tide bg-navy text-white font-semibold [--tide-fill:rgb(215_166_71)] [--tide-fg-hover:rgb(11_38_83)]",
        tideOutline:
          "tide bg-transparent text-navy font-semibold border-[1.5px] border-navy [--tide-fill:rgb(11_38_83)] [--tide-fg-hover:#ffffff]",
        tideLight:
          "tide bg-white text-navy font-semibold [--tide-fill:rgb(215_166_71)] [--tide-fg-hover:rgb(11_38_83)]",
        tideOutlineLight:
          "tide bg-transparent text-white font-semibold border-[1.5px] border-white/70 [--tide-fill:#ffffff] [--tide-fg-hover:rgb(11_38_83)]",
      },
      size: {
        default: "h-11 md:h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-11 w-11 md:h-10 md:w-10",
      },
    },
    compoundVariants: [
      // Tide buttons are pills: 48 px (default), 40 px (sm), 56 px (lg).
      { variant: [...TIDE_VARIANTS], size: "default", className: "h-12 md:h-12 gap-2 rounded-full px-6 text-base" },
      // 44 px on phones (touch target), 40 px from md.
      { variant: [...TIDE_VARIANTS], size: "sm", className: "h-11 md:h-10 gap-1.5 rounded-full px-4 text-sm" },
      { variant: [...TIDE_VARIANTS], size: "lg", className: "h-14 gap-2.5 rounded-full px-8 text-[17px]" },
      { variant: [...TIDE_VARIANTS], size: "icon", className: "h-12 w-12 md:h-12 md:w-12 rounded-full" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

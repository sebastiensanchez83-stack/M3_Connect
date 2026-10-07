import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The shadcn Button, used everywhere (admin, account, SM26 consoles): the
 * original variants and sizes are unchanged.
 *
 * Refonte (Oct 2026) adds the rolling "cta" family, for the public pages, in
 * the spirit of the Solar Impulse Foundation site: on hover and keyboard focus
 * the label slides up while a copy rises from below, and the round disc on the
 * right turns gold while its arrow leaves to the right and a
 * copy enters from the left (.525 s, cubic-bezier(.625,.05,0,1)).
 * Pill shaped; 52 px by default, 44 px (sm), 56 px (lg).
 *   cta        gold, navy text; hover: navy          THE main action (one per screen), on light backgrounds
 *   ctaOnDark  gold, navy text; hover: white         the same main action on navy panels or photos
 *                                                    (a navy hover on a navy band would make it vanish)
 *   ctaNavy    navy, white text; hover: gold         secondary, on light backgrounds
 *   ctaOutline 2 px navy border; hover: navy fill    tertiary, on light backgrounds
 *   ctaLight   2 px white border; hover: white fill  on photos and navy panels
 *   ctaWhite   white, navy text                      on photos and navy panels
 * `size="icon"` gives a round icon button with the colour change only (no roll).
 *
 * The roll needs markup (two copies of the label, the disc): the Button adds it
 * itself, also with `asChild` (it wraps the child's own children). Pass the
 * label as plain children, WITHOUT a trailing arrow icon (the disc is the
 * arrow). `arrow={false}` drops the disc, `roll={false}` keeps the label still
 * (a label that wraps over several lines cannot roll).
 * `buttonVariants({ variant: "cta…" })` alone styles an element but cannot add
 * that markup: wrap links in <Button asChild> instead.
 *
 * The CSS lives in src/styles/smc-motion.css (.cta, .cta-l, .cta-t, .cta-d);
 * the colours come from the --cta-* variables set by the variants below.
 */
export const CTA_VARIANTS = ["cta", "ctaOnDark", "ctaNavy", "ctaOutline", "ctaLight", "ctaWhite"] as const
type CtaVariant = (typeof CTA_VARIANTS)[number]
const isCtaVariant = (v: unknown): v is CtaVariant => (CTA_VARIANTS as readonly unknown[]).includes(v)

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
        cta:
          "cta border-2 border-gold bg-gold text-navy font-semibold [--cta-bg-h:rgb(11_38_83)] [--cta-fg-h:#ffffff] [--cta-disc-bg:rgb(11_38_83)] [--cta-disc-fg:#ffffff] [--cta-disc-bg-h:rgb(215_166_71)] [--cta-disc-fg-h:rgb(11_38_83)]",
        ctaOnDark:
          "cta border-2 border-gold bg-gold text-navy font-semibold [--cta-bg-h:#ffffff] [--cta-fg-h:rgb(11_38_83)] [--cta-disc-bg:rgb(11_38_83)] [--cta-disc-fg:#ffffff] [--cta-disc-bg-h:rgb(215_166_71)] [--cta-disc-fg-h:rgb(11_38_83)]",
        ctaNavy:
          "cta border-2 border-navy bg-navy text-white font-semibold [--cta-bg-h:rgb(215_166_71)] [--cta-fg-h:rgb(11_38_83)] [--cta-disc-bg:#ffffff] [--cta-disc-fg:rgb(11_38_83)] [--cta-disc-bg-h:rgb(11_38_83)] [--cta-disc-fg-h:#ffffff]",
        ctaOutline:
          "cta border-2 border-navy bg-transparent text-navy font-semibold [--cta-bg-h:rgb(11_38_83)] [--cta-fg-h:#ffffff] [--cta-disc-bg:rgb(11_38_83)] [--cta-disc-fg:#ffffff] [--cta-disc-bg-h:rgb(215_166_71)] [--cta-disc-fg-h:rgb(11_38_83)]",
        ctaLight:
          "cta border-2 border-white/50 bg-transparent text-white font-semibold [--cta-bg-h:#ffffff] [--cta-border-h:#ffffff] [--cta-fg-h:rgb(11_38_83)] [--cta-disc-bg:#ffffff] [--cta-disc-fg:rgb(11_38_83)] [--cta-disc-bg-h:rgb(215_166_71)] [--cta-disc-fg-h:rgb(11_38_83)]",
        ctaWhite:
          "cta border-2 border-white bg-white text-navy font-semibold [--cta-bg-h:#ffffff] [--cta-fg-h:rgb(11_38_83)] [--cta-disc-bg:rgb(11_38_83)] [--cta-disc-fg:#ffffff] [--cta-disc-bg-h:rgb(215_166_71)] [--cta-disc-fg-h:rgb(11_38_83)]",
      },
      size: {
        default: "h-11 md:h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-11 w-11 md:h-10 md:w-10",
      },
    },
    compoundVariants: [
      // CTA buttons are pills with the disc flush right: 52 px (default), 44 px (sm), 56 px (lg).
      { variant: [...CTA_VARIANTS], size: "default", className: "h-[52px] md:h-[52px] gap-3.5 rounded-full py-0 pl-[22px] pr-[5px] text-base [--cta-disc:38px]" },
      { variant: [...CTA_VARIANTS], size: "sm", className: "h-11 md:h-11 gap-2.5 rounded-full py-0 pl-[18px] pr-1 text-[15px] [--cta-disc:32px]" },
      { variant: [...CTA_VARIANTS], size: "lg", className: "h-14 gap-4 rounded-full py-0 pl-7 pr-1.5 text-[17px] [--cta-disc:42px]" },
      { variant: [...CTA_VARIANTS], size: "icon", className: "h-12 w-12 md:h-12 md:w-12 rounded-full p-0" },
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
  /** cta variants: the round arrow disc on the right (default on). */
  arrow?: boolean
  /** cta variants: the label rolls up on hover (default on). Off for labels that wrap. */
  roll?: boolean
}

/** The label (twice, for the roll) and the arrow disc. */
function CtaInner({ children, arrow, roll }: { children: React.ReactNode; arrow: boolean; roll: boolean }) {
  return (
    <>
      <span className={cn("cta-l", roll && "cta-roll")}>
        <span className="cta-t">{children}</span>
        {roll && (
          <span className="cta-t cta-c" aria-hidden="true">
            {children}
          </span>
        )}
      </span>
      {arrow && (
        <span className="cta-d" aria-hidden="true">
          <ArrowRight className="cta-a1" strokeWidth={2.25} />
          <ArrowRight className="cta-a2" strokeWidth={2.25} />
        </span>
      )}
    </>
  )
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, arrow = true, roll = true, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    if (!isCtaVariant(variant) || size === "icon") {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      )
    }
    // Without the disc the right padding matches the left one.
    const noDisc = !arrow && (size === "sm" ? "pr-4" : size === "lg" ? "pr-7" : "pr-[22px]")
    const cls = cn(buttonVariants({ variant, size }), noDisc, className)
    if (asChild && React.isValidElement(children)) {
      // The roll goes inside the child (a Link, an <a>): wrap the child's own children.
      const child = children as React.ReactElement<{ children?: React.ReactNode }>
      return (
        <Slot className={cls} ref={ref} {...props}>
          {React.cloneElement(
            child,
            {},
            <CtaInner arrow={arrow} roll={roll}>
              {child.props.children}
            </CtaInner>,
          )}
        </Slot>
      )
    }
    return (
      <Comp className={cls} ref={ref} {...props}>
        <CtaInner arrow={arrow} roll={roll}>
          {children}
        </CtaInner>
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

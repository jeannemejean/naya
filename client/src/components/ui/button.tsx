import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Naya button.
 * • primary   — olive fill on cream, body-cased label
 * • secondary — cream fill, olive hairline, body-cased label
 * • ghost     — no fill, no border, body-cased label
 * • display   — uppercase display label (tracking-xwide). Use for CTAs.
 * • link      — inline text with olive underline (hover: solid)
 *
 * Sizes: sm (28), md (36 default), lg (44), icon (square 36).
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 select-none cursor-pointer",
    "transition-[background,color,border-color,transform] duration-base ease-quiet",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:translate-y-[0.5px]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-naya-olive text-naya-cream hover:bg-naya-olive-90 rounded-md",
        primary:
          "bg-naya-olive text-naya-cream hover:bg-naya-olive-90 rounded-md",
        destructive:
          "bg-naya-mauve text-naya-cream hover:opacity-90 rounded-md",
        outline:
          "bg-transparent text-naya-olive border border-naya-olive-18 hover:bg-naya-olive-06 hover:border-naya-olive-35 rounded-md",
        secondary:
          "bg-transparent text-naya-olive border border-naya-olive-18 hover:bg-naya-olive-06 hover:border-naya-olive-35 rounded-md",
        ghost:
          "bg-transparent text-naya-olive-70 hover:bg-naya-olive-06 hover:text-naya-olive rounded-md",
        display:
          "bg-naya-olive text-naya-cream hover:bg-naya-olive-90 rounded-md font-display uppercase tracking-xwide",
        link:
          "text-naya-olive border-b border-naya-olive-35 hover:border-naya-olive rounded-none px-0 h-auto",
      },
      size: {
        sm:      "h-7 px-3 text-xs",
        default: "h-9 px-4 text-sm",
        md:      "h-9 px-4 text-sm",
        lg:      "h-11 px-6 text-sm",
        icon:    "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
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
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Naya button.
 * • primary   — ancre sombre, label en casse normale
 * • secondary — surface carte sans bordure, ombre cocon
 * • ghost     — no fill, no border, body-cased label
 * • display   — uppercase display label (tracking-xwide). Use for CTAs.
 * • link      — inline text with olive underline (hover: solid)
 *
 * Sizes: sm (36, zone cliquable 44), default/md/lg (44), icon (44x44).
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 select-none cursor-pointer",
    "transition-[background,color,border-color,transform] duration-base ease-quiet",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:translate-y-[0.5px]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[#3D372F] rounded-full",
        primary:
          "bg-primary text-primary-foreground hover:bg-[#3D372F] rounded-full",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-95 rounded-full",
        outline:
          "bg-card text-foreground shadow-cocon hover:bg-muted rounded-full",
        secondary:
          "bg-card text-foreground shadow-cocon hover:bg-muted rounded-full",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground rounded-full",
        display:
          "bg-primary text-primary-foreground hover:bg-[#3D372F] rounded-full font-display uppercase tracking-xwide",
        link:
          "text-naya-olive border-b border-naya-olive-35 hover:border-naya-olive rounded-none px-0 h-auto",
      },
      size: {
        sm:      "relative h-9 px-3.5 text-xs before:content-[''] before:absolute before:-inset-1",
        default: "h-11 px-5 text-sm",
        md:      "h-11 px-5 text-sm",
        lg:      "h-11 px-7 text-sm",
        icon:    "h-11 w-11 p-0",
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

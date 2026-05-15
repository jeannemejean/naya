import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Naya tag / status chip — uppercase display caps, pill radius.
 * One accent per visual surface; never two together.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5 px-2.5 py-1",
    "rounded-pill font-display uppercase tracking-xwide text-[9px] font-normal",
  ].join(" "),
  {
    variants: {
      variant: {
        default:     "bg-naya-olive-06 text-naya-olive",
        neutral:     "bg-naya-olive-06 text-naya-olive",
        secondary:   "bg-naya-olive-06 text-naya-olive",
        sulphur:     "bg-[rgba(212,201,122,0.22)] text-[#6f6526]",
        salvia:      "bg-[rgba(125,143,168,0.22)] text-[#46556d]",
        mauve:       "bg-[rgba(158,126,135,0.22)] text-[#6e4b53]",
        outline:     "bg-transparent text-naya-olive-70 border border-naya-olive-18",
        destructive: "bg-[rgba(158,126,135,0.22)] text-[#6e4b53]",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function Badge({ className, variant, dot, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        dot && "before:inline-block before:w-[5px] before:h-[5px] before:rounded-full before:flex-shrink-0",
        dot && variant === "sulphur" && "before:bg-naya-sulphur",
        dot && variant === "salvia"  && "before:bg-naya-salvia",
        dot && variant === "mauve"   && "before:bg-naya-mauve",
        dot && (variant === "default" || variant === "neutral" || !variant) && "before:bg-naya-olive",
        className,
      )}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
export type { BadgeProps }

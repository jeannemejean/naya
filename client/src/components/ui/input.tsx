import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Naya input — hairline border, soft radius, no shadow.
 * Focus = 1px olive ring at 2px offset. Never a glow.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full bg-card text-base text-foreground",
        "px-4 py-2 rounded-champ",
        "border-0 placeholder:text-muted-foreground",
        "transition-colors duration-base ease-quiet",
        "hover:shadow-cocon",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:text-foreground",
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = "Input"

export { Input }

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
        "flex h-10 w-full bg-transparent text-base text-foreground",
        "px-3.5 py-2 rounded-sm",
        "border border-naya-olive-18 placeholder:text-naya-olive-55",
        "transition-colors duration-base ease-quiet",
        "hover:border-naya-olive-35",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-naya-olive",
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

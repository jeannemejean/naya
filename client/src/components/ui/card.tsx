import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Naya card.
 * Surface carte, ombre cocon, sans bordure, rayon 20.
 * Optional `accent` adds a 1.5px top stripe — one accent per visual surface.
 */
type AccentKey = "sulphur" | "salvia" | "mauve"

const ACCENT_CLASS: Record<AccentKey, string> = {
  sulphur: "before:bg-naya-sulphur",
  salvia:  "before:bg-naya-salvia",
  mauve:   "before:bg-naya-mauve",
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: AccentKey
  lift?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, accent, lift, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative bg-card text-card-foreground rounded-carte shadow-cocon border-0",
        "transition-shadow duration-base ease-quiet",
        lift && "shadow-lift",
        accent && [
          "before:content-[''] before:absolute before:top-0 before:left-5 before:right-5",
          "before:h-[1.5px] before:rounded-sm",
          ACCENT_CLASS[accent],
        ],
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-between p-6 pb-3 sm:p-8 sm:pb-4", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardEyebrow = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("font-display text-[11px] text-foreground", className)}
    {...props}
  />
))
CardEyebrow.displayName = "CardEyebrow"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-display text-md text-foreground", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-base text-foreground/80 leading-[1.6]", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-6 pb-6 sm:px-8 sm:pb-8", className)}
    {...props}
  />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center justify-between px-6 pb-6 pt-4 sm:px-8 sm:pb-8 border-t border-naya-olive-10 mt-4",
      className,
    )}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardHeader,
  CardEyebrow,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
}

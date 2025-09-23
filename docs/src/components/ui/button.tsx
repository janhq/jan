import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer",
  {
    variants: {
      variant: {
        "playful-green":
          "bg-[#7EF19D] hover:bg-[#6BD689] hover:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] active:shadow-[0px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-[2px] text-black shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border border-black !rounded-2xl",
        "playful-white":
          "bg-white text-black hover:bg-gray-200 hover:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] active:shadow-[0px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-[2px] shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border border-black !rounded-2xl",
        playful:
          "text-black hover:shadow-[0px_0px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[2px] active:shadow-[0px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-[2px] shadow-[0px_4px_0px_0px_rgba(0,0,0,1)] border border-black !rounded-2xl",
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        xl: "h-12 rounded-md px-6 has-[>svg]:px-4 text-lg",
        xxl: "h-16 !rounded-[20px] px-6 has-[>svg]:px-4 text-xl -tracking-[0.2px]",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

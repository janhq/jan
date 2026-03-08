"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface FoldersIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface FoldersIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const FoldersIcon = forwardRef<FoldersIconHandle, FoldersIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.path
            animate={controls}
            d="M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z"
            transition={{
              type: "spring",
              stiffness: 250,
              damping: 25,
            }}
            variants={{
              normal: {
                translateX: 0,
                translateY: 0,
              },
              animate: {
                translateX: -2,
                translateY: 2,
              },
            }}
          />
          <motion.path
            animate={controls}
            d="M2 8v11a2 2 0 0 0 2 2h14"
            transition={{
              type: "spring",
              stiffness: 250,
              damping: 25,
            }}
            variants={{
              normal: {
                translateX: 0,
                translateY: 0,
                opacity: 1,
                scale: 1,
              },
              animate: {
                translateX: 2,
                translateY: -2,
                opacity: 0,
                scale: 0.9,
              },
            }}
          />
        </svg>
      </div>
    );
  }
);

FoldersIcon.displayName = "FoldersIcon";

export { FoldersIcon };

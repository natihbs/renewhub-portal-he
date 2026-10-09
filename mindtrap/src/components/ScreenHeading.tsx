"use client";

import { useEffect, useRef } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Move focus here on mount so keyboard and screen-reader users follow screen changes. */
  focusOnMount?: boolean;
  as?: "h1" | "h2";
}

export function ScreenHeading({ children, className = "", focusOnMount = true, as: Tag = "h1" }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: false });
  }, [focusOnMount]);
  return (
    <Tag ref={ref} tabIndex={-1} className={`outline-none focus-visible:outline-none ${className}`}>
      {children}
    </Tag>
  );
}

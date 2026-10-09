/** Isolates left-to-right content (English labels, numbers, hashes) inside RTL text. */
export function Ltr({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

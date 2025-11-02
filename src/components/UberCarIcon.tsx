// Uber car icon SVG component
export function UberCarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Car body */}
      <path
        d="M5 11L6.5 6.5H17.5L19 11H20C20.5523 11 21 11.4477 21 12V14C21 14.5523 20.5523 15 20 15H19V17C19 17.5523 18.5523 18 18 18H17C16.4477 18 16 17.5523 16 17V15H8V17C8 17.5523 7.55228 18 7 18H6C5.44772 18 5 17.5523 5 17V15H4C3.44772 15 3 14.5523 3 14V12C3 11.4477 3.44772 11 4 11H5Z"
        stroke="#101010"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="#ffffff"
      />
      {/* Car windows */}
      <path
        d="M7 11H11V13H7V11Z"
        fill="#101010"
      />
      <path
        d="M13 11H17V13H13V11Z"
        fill="#101010"
      />
      {/* Wheels */}
      <circle cx="7.5" cy="15.5" r="1.5" fill="#101010" />
      <circle cx="16.5" cy="15.5" r="1.5" fill="#101010" />
    </svg>
  );
}


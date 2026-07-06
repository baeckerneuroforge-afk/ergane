import Link from "next/link";

/* ---------- HelixMark — SVG helix logo icon ---------- */
export function HelixMark({
  size = 28,
  tone,
  variant,
  className = "",
}: {
  size?: number;
  /** @deprecated use `tone` */
  variant?: "light" | "dark";
  tone?: "light" | "dark";
  className?: string;
}) {
  // `variant` is a legacy alias for `tone`
  const resolvedTone = tone ?? variant ?? "light";
  const steel = resolvedTone === "dark" ? "#8A93C7" : "#39426B";
  const ember = resolvedTone === "dark" ? "#F26B1F" : "#D6531A";
  const rung = resolvedTone === "dark" ? "#6C6E78" : "#85878F";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M18 6 C18 20, 46 26, 46 40 C46 50, 36 56, 26 58"
        fill="none"
        stroke={steel}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M46 6 C46 20, 18 26, 18 40 C18 50, 28 56, 38 58"
        fill="none"
        stroke={ember}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="14"
        x2="40"
        y2="14"
        stroke={rung}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="27"
        y1="32"
        x2="37"
        y2="32"
        stroke={rung}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="48"
        x2="40"
        y2="48"
        stroke={rung}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- HelixWordmark — Logo + "helix.ai" as Link to "/" ---------- */
export function HelixWordmark({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const textColor = tone === "dark" ? "#E8E8EC" : "#17181C";
  return (
    <Link
      href="/"
      className={`m-flex m-items-center m-gap-2 ${className}`}
      style={{ textDecoration: "none" }}
    >
      <HelixMark size={28} tone={tone} />
      <span
        style={{
          fontFamily:
            "var(--font-display, 'Fraunces', Georgia, serif)",
          fontSize: 19,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: textColor,
        }}
      >
        helix
        <span style={{ fontWeight: 400, opacity: 0.5 }}>.ai</span>
      </span>
    </Link>
  );
}

/* ---------- DNAStrand — decorative double-helix SVG background ---------- */
export function DNAStrand({
  variant = "vertical",
  tone = "light",
  className = "",
}: {
  variant?: "vertical" | "diagonal";
  tone?: "light" | "dark";
  className?: string;
}) {
  const left = tone === "dark" ? "#3D4670" : "#39426B";
  const right = tone === "dark" ? "#A0522D" : "#D6531A";
  const rungColor = tone === "dark" ? "#4A4C55" : "#E0DDD6";
  const opacity = tone === "dark" ? 0.18 : 0.12;

  if (variant === "diagonal") {
    return (
      <svg
        viewBox="0 0 200 600"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
        style={{ opacity }}
      >
        <path
          d="M40 0 C40 80, 160 120, 160 200 C160 280, 40 320, 40 400 C40 480, 160 520, 160 600"
          fill="none"
          stroke={left}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M160 0 C160 80, 40 120, 40 200 C40 280, 160 320, 160 400 C160 480, 40 520, 40 600"
          fill="none"
          stroke={right}
          strokeWidth="3"
          strokeLinecap="round"
        />
        {[60, 100, 160, 200, 260, 300, 360, 400, 460, 500].map(
          (y) => (
            <line
              key={y}
              x1="70"
              y1={y}
              x2="130"
              y2={y}
              stroke={rungColor}
              strokeWidth="2"
              strokeLinecap="round"
            />
          )
        )}
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 100 600"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      style={{ opacity }}
    >
      <path
        d="M20 0 C20 60, 80 90, 80 150 C80 210, 20 240, 20 300 C20 360, 80 390, 80 450 C80 510, 20 540, 20 600"
        fill="none"
        stroke={left}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M80 0 C80 60, 20 90, 20 150 C20 210, 80 240, 80 300 C80 360, 20 390, 20 450 C20 510, 80 540, 80 600"
        fill="none"
        stroke={right}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {[30, 75, 120, 165, 210, 255, 300, 345, 390, 435, 480, 525, 570].map(
        (y) => (
          <line
            key={y}
            x1="30"
            y1={y}
            x2="70"
            y2={y}
            stroke={rungColor}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )
      )}
    </svg>
  );
}

/* ---------- Rung — horizontal divider with colored dots ---------- */
export function Rung({ className = "" }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        width: "100%",
      }}
      aria-hidden="true"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "999px",
          background: "#39426B",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          height: 1,
          background: "var(--m-hairline, #E9E8E3)",
        }}
      />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "999px",
          background: "#D6531A",
          flexShrink: 0,
        }}
      />
    </div>
  );
}

/* ---------- HelixBand — horizontal double-helix ribbon divider ---------- */
export function HelixBand({ className = "" }: { className?: string }) {
  return (
    <div
      className={className}
      style={{ width: "100%", overflow: "hidden" }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1200 40"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", height: 40, display: "block" }}
        preserveAspectRatio="none"
      >
        <path
          d="M0 20 C100 5, 200 35, 300 20 C400 5, 500 35, 600 20 C700 5, 800 35, 900 20 C1000 5, 1100 35, 1200 20"
          fill="none"
          stroke="#39426B"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.15"
        />
        <path
          d="M0 20 C100 35, 200 5, 300 20 C400 35, 500 5, 600 20 C700 35, 800 5, 900 20 C1000 35, 1100 5, 1200 20"
          fill="none"
          stroke="#D6531A"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.15"
        />
        {[75, 150, 225, 375, 450, 525, 675, 750, 825, 975, 1050, 1125].map(
          (x) => (
            <line
              key={x}
              x1={x}
              y1="15"
              x2={x}
              y2="25"
              stroke="#85878F"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.12"
            />
          )
        )}
      </svg>
    </div>
  );
}

/* ---------- HelixOrbit — circular double-helix decorative ring ---------- */
export function HelixOrbit({
  size = 280,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const r = size / 2;
  const cx = r;
  const cy = r;
  const pathR = r * 0.78;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
      className={`m-spin-slow ${className}`}
      aria-hidden="true"
      style={{ opacity: 0.12 }}
    >
      {/* Outer strand */}
      <circle
        cx={cx}
        cy={cy}
        r={pathR}
        fill="none"
        stroke="#39426B"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="12 8"
      />
      {/* Inner strand */}
      <circle
        cx={cx}
        cy={cy}
        r={pathR * 0.85}
        fill="none"
        stroke="#D6531A"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="10 10"
      />
      {/* Rungs connecting the two circles */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = cx + pathR * Math.cos(rad);
        const y1 = cy + pathR * Math.sin(rad);
        const x2 = cx + pathR * 0.85 * Math.cos(rad);
        const y2 = cy + pathR * 0.85 * Math.sin(rad);
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#85878F"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

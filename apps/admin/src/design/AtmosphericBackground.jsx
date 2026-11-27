import React from 'react';

export default function AtmosphericBackground({ mode = 'cinematic' }) {
  if (mode === 'minimal') return null;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none">
      {/* Deep atmospheric backdrop base */}
      <div className="absolute inset-0 bg-[#0b0f13]" />

      {/* Scenic silhouettes & misty dusk layer */}
      <div 
        className={`absolute inset-0 transition-opacity duration-1000 ${
          mode === 'cinematic' ? 'opacity-35' : 'opacity-15'
        }`}
        style={{
          backgroundImage: `radial-gradient(circle at 75% 20%, rgba(246, 155, 97, 0.18) 0%, transparent 45%),
                            radial-gradient(circle at 20% 80%, rgba(54, 188, 169, 0.08) 0%, transparent 50%),
                            radial-gradient(circle at 50% 50%, rgba(28, 37, 49, 0.9) 0%, transparent 100%)`
        }}
      />

      {/* Atmospheric silhouette artwork (person walking in misty sunset/dusk) */}
      <svg
        className={`absolute right-0 bottom-0 w-full h-full max-h-[900px] object-cover transition-opacity duration-1000 ${
          mode === 'cinematic' ? 'opacity-25' : 'opacity-10'
        }`}
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMaxYMax slice"
      >
        <defs>
          <linearGradient id="mistGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d5824d" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#1c2531" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#0b0f13" stopOpacity="0.8" />
          </linearGradient>
          <linearGradient id="warmSun" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#ffad68" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#d5824d" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Distant European city skyline / Lisbon rooftops silhouette */}
        <path
          d="M0 650 Q240 620 480 635 T960 620 Q1200 640 1440 610 L1440 900 L0 900 Z"
          fill="#11171f"
          fillOpacity="0.6"
        />
        <path
          d="M100 680 L200 640 L220 640 L240 680 L400 680 L440 610 L460 610 L500 680 L750 670 L820 590 L850 590 L920 670 L1180 660 L1250 600 L1290 600 L1350 680 L1440 670 L1440 900 L100 900 Z"
          fill="#0c1117"
          fillOpacity="0.8"
        />

        {/* Ambient warm dusk orb */}
        <circle cx="1080" cy="380" r="280" fill="url(#warmSun)" filter="blur(60px)" />

        {/* Subtle silhouette of person walking along ancient cobblestone street */}
        <g transform="translate(1020, 480) scale(0.65)" opacity="0.45">
          {/* Head & hat */}
          <ellipse cx="60" cy="50" rx="14" ry="17" fill="#080c10" />
          {/* Torso & trench coat in motion */}
          <path d="M46 67 C46 67 30 110 24 165 C32 170 85 168 94 165 C88 115 72 67 72 67 Z" fill="#090d12" />
          {/* Legs */}
          <path d="M38 165 L30 250 L42 253 L54 185 L68 248 L80 245 L68 165 Z" fill="#080c10" />
          {/* Walking stick / shadow */}
          <ellipse cx="60" cy="254" rx="45" ry="8" fill="#05080c" opacity="0.6" />
        </g>

        {/* Misty atmospheric fog streaks */}
        <rect x="0" y="450" width="1440" height="450" fill="url(#mistGrad)" />
      </svg>

      {/* Ambient noise / soft glow spots */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-gradient-to-br from-[#f69b61]/10 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[32rem] h-96 bg-gradient-to-t from-[#36bca9]/8 to-transparent rounded-full blur-3xl pointer-events-none" />
    </div>
  );
}


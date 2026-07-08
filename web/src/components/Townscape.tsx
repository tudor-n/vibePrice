/**
 * Watercolor townscape illustration — React recreation of the design handoff's
 * `Townscape.dc.html` reference SVG (sunset sky, drifting clouds, birds, church
 * spire, mansard roofs, lit windows, bunting, cobbled street).
 *
 * Purely decorative: always `aria-hidden`. The hex values in here are
 * illustration washes, not UI tokens (see handoff README) — they live in the
 * artwork itself, like pigment in a painting.
 *
 * Animation (clouds drift, birds fly/flap) is opt-in via the `animated` prop
 * and driven entirely by CSS classes in global.css. Only the login screen sets
 * it; data screens are static by design. `prefers-reduced-motion` disables it.
 */

import { useId } from 'react';

const COBBLE_FILLS = ['#c2b49c', '#b3a58d', '#c9bca6', '#ab9d86', '#bcaf98'];

function cobbleRow(y: number, rx: number, ry: number, step: number, x0: number) {
  const stones = [];
  for (let x = x0, i = 0; x < 1030; x += step, i += 1) {
    stones.push(
      <ellipse
        key={x}
        cx={x}
        cy={y}
        rx={rx}
        ry={ry}
        fill={COBBLE_FILLS[i % COBBLE_FILLS.length]}
      />,
    );
  }
  return stones;
}

interface BirdProps {
  transform: string;
  flightClass: string;
}

function Bird({ transform, flightClass }: BirdProps) {
  return (
    <g transform={transform}>
      <g className={flightClass}>
        <g className="ts-flap-l">
          <path d="M0 0 Q-8 -9 -17 -3" />
        </g>
        <g className="ts-flap-r">
          <path d="M0 0 Q8 -9 17 -3" />
        </g>
      </g>
    </g>
  );
}

export function Townscape({ animated = false }: { animated?: boolean }) {
  // Unique ids so several instances on one page never cross-reference filters.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (name: string) => `ts-${uid}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;

  return (
    <svg
      className={animated ? 'townscape townscape-animated' : 'townscape'}
      viewBox="0 0 1000 720"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9d2da" />
          <stop offset="0.3" stopColor="#e4c6b6" />
          <stop offset="0.55" stopColor="#f2c89e" />
          <stop offset="0.78" stopColor="#f8daa4" />
          <stop offset="1" stopColor="#f6e6c6" />
        </linearGradient>
        <radialGradient id={id('sunGlow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe9b0" stopOpacity="0.9" />
          <stop offset="0.35" stopColor="#f7cf88" stopOpacity="0.5" />
          <stop offset="0.7" stopColor="#f2b978" stopOpacity="0.18" />
          <stop offset="1" stopColor="#f2b978" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('sunCore')} cx="0.5" cy="0.45" r="0.62">
          <stop offset="0" stopColor="#fff6db" />
          <stop offset="0.45" stopColor="#fbe0a0" stopOpacity="0.85" />
          <stop offset="0.8" stopColor="#f4c874" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f4c874" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('cloud')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff9f0" />
          <stop offset="1" stopColor="#f0cfa6" />
        </linearGradient>
        <linearGradient id={id('horizon')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8d9a0" stopOpacity="0" />
          <stop offset="1" stopColor="#f6cf94" stopOpacity="0.55" />
        </linearGradient>
        <filter id={id('wc')} x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.016"
            numOctaves="3"
            seed="7"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="9"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id={id('ink')} x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02 0.03"
            numOctaves="2"
            seed="3"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="4"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter id={id('soft')}>
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={id('grain')}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves="2"
            stitchTiles="stitch"
            result="n"
          />
          <feColorMatrix in="n" type="saturate" values="0" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1000" height="720" fill={url('sky')} />
      <rect x="0" y="360" width="1000" height="360" fill={url('horizon')} />

      {/* setting sun, low over the rooftops */}
      <circle cx="772" cy="300" r="320" fill={url('sunGlow')} />
      <g
        stroke="#ffe6ad"
        strokeOpacity="0.13"
        strokeWidth="10"
        strokeLinecap="round"
        filter={url('soft')}
      >
        <line x1="772" y1="300" x2="520" y2="150" />
        <line x1="772" y1="300" x2="730" y2="70" />
        <line x1="772" y1="300" x2="965" y2="120" />
      </g>
      <g filter={url('wc')}>
        <circle cx="772" cy="300" r="66" fill={url('sunCore')} />
      </g>
      <circle cx="772" cy="300" r="72" fill="#f6d99c" opacity="0.45" filter={url('soft')} />
      <circle cx="770" cy="298" r="34" fill="#fff6da" opacity="0.7" filter={url('soft')} />

      {/* sunset-lit clouds (drift only when .townscape-animated) */}
      <g opacity="0.92">
        <g filter={url('soft')} className="ts-cloud-a">
          <ellipse cx="210" cy="134" rx="150" ry="11" fill="#e6b489" opacity="0.4" />
          <g fill={url('cloud')}>
            <ellipse cx="150" cy="132" rx="60" ry="18" />
            <ellipse cx="280" cy="134" rx="64" ry="18" />
            <ellipse cx="210" cy="120" rx="96" ry="26" />
          </g>
        </g>
        <g filter={url('soft')} className="ts-cloud-b">
          <ellipse cx="560" cy="104" rx="128" ry="9" fill="#e6b489" opacity="0.34" />
          <g fill={url('cloud')}>
            <ellipse cx="510" cy="102" rx="52" ry="15" />
            <ellipse cx="615" cy="102" rx="54" ry="15" />
            <ellipse cx="560" cy="92" rx="86" ry="22" />
          </g>
        </g>
        <g filter={url('soft')} className="ts-cloud-c">
          <ellipse cx="896" cy="160" rx="104" ry="7" fill="#e2ad82" opacity="0.32" />
          <g fill={url('cloud')}>
            <ellipse cx="860" cy="160" rx="44" ry="13" />
            <ellipse cx="900" cy="150" rx="70" ry="19" />
          </g>
        </g>
      </g>

      {/* distant faint back row for depth */}
      <g fill="#cdb9d0" opacity="0.35" filter={url('wc')}>
        <rect x="60" y="420" width="90" height="220" />
        <rect x="150" y="380" width="70" height="260" />
        <rect x="470" y="400" width="100" height="240" />
        <rect x="700" y="430" width="80" height="210" />
        <rect x="860" y="400" width="90" height="240" />
      </g>

      {/* main building row */}
      <g filter={url('wc')}>
        <rect x="30" y="380" width="130" height="260" fill="#9fbc9b" opacity="0.92" />
        <polygon points="20,382 95,320 170,382" fill="#6f9a86" opacity="0.95" />
      </g>
      <g filter={url('wc')}>
        <rect x="150" y="330" width="120" height="310" fill="#d98c6a" opacity="0.92" />
        <polygon points="150,332 210,270 270,332" fill="#b5654a" opacity="0.95" />
        <path d="M195 270 q15 -26 30 0 z" fill="#b5654a" />
      </g>
      <g filter={url('wc')}>
        <rect x="262" y="420" width="86" height="220" fill="#ede0c6" opacity="0.94" />
        <polygon points="256,422 305,378 354,422" fill="#c9a06a" opacity="0.95" />
      </g>
      {/* church spire */}
      <g filter={url('wc')}>
        <rect x="352" y="300" width="120" height="340" fill="#ecdfc4" opacity="0.95" />
        <polygon points="352,302 412,150 472,302" fill="#3f6f6a" opacity="0.95" />
        <rect x="398" y="360" width="28" height="60" rx="14" fill="#3f6f6a" opacity="0.85" />
      </g>
      {/* dusty blue mansard */}
      <g filter={url('wc')}>
        <rect x="470" y="352" width="140" height="288" fill="#9fc0d6" opacity="0.9" />
        <path d="M462 354 h156 l-24 -54 h-108 z" fill="#5e88a6" opacity="0.95" />
      </g>
      <g filter={url('wc')}>
        <rect x="608" y="400" width="104" height="240" fill="#d9a79f" opacity="0.92" />
        <polygon points="600,402 660,352 720,402" fill="#b47d76" opacity="0.95" />
      </g>
      <g filter={url('wc')}>
        <rect x="710" y="336" width="120" height="304" fill="#e0b25e" opacity="0.9" />
        <polygon points="702,338 770,282 838,338" fill="#c98a3c" opacity="0.95" />
      </g>
      <g filter={url('wc')}>
        <rect x="828" y="392" width="132" height="248" fill="#e7d9bd" opacity="0.94" />
        <polygon points="820,394 894,344 968,394" fill="#b5654a" opacity="0.92" />
      </g>

      {/* ink outlines */}
      <g
        filter={url('ink')}
        fill="none"
        stroke="#4a3b2f"
        strokeWidth="2.1"
        strokeOpacity="0.62"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="30" y="380" width="130" height="260" />
        <polyline points="20,382 95,320 170,382" />
        <rect x="150" y="330" width="120" height="310" />
        <polyline points="150,332 210,270 270,332" />
        <rect x="262" y="420" width="86" height="220" />
        <polyline points="256,422 305,378 354,422" />
        <rect x="352" y="300" width="120" height="340" />
        <polyline points="352,302 412,150 472,302" />
        <rect x="470" y="352" width="140" height="288" />
        <path d="M462 354 h156 l-24 -54 h-108 z" />
        <rect x="608" y="400" width="104" height="240" />
        <polyline points="600,402 660,352 720,402" />
        <rect x="710" y="336" width="120" height="304" />
        <polyline points="702,338 770,282 838,338" />
        <rect x="828" y="392" width="132" height="248" />
        <polyline points="820,394 894,344 968,394" />
        <line x1="412" y1="150" x2="412" y2="130" />
        <line x1="404" y1="138" x2="420" y2="138" />
      </g>

      {/* window glow + frames */}
      <g filter={url('ink')}>
        <g
          fill="#f6e2b0"
          fillOpacity="0.85"
          stroke="#4a3b2f"
          strokeOpacity="0.55"
          strokeWidth="1.6"
        >
          <rect x="58" y="430" width="30" height="42" rx="3" />
          <rect x="104" y="430" width="30" height="42" rx="3" />
          <rect x="58" y="500" width="30" height="42" rx="3" />
          <rect x="104" y="500" width="30" height="42" rx="3" />
          <rect x="178" y="372" width="30" height="44" rx="3" />
          <rect x="214" y="372" width="30" height="44" rx="3" />
          <rect x="178" y="446" width="30" height="44" rx="3" />
          <rect x="214" y="446" width="30" height="44" rx="3" />
          <rect x="284" y="456" width="26" height="40" rx="3" />
          <rect x="300" y="524" width="26" height="40" rx="3" />
          <path d="M392 360 h40 v34 a20 20 0 0 1 -40 0 z" />
          <rect x="500" y="392" width="30" height="46" rx="3" />
          <rect x="548" y="392" width="30" height="46" rx="3" />
          <rect x="500" y="470" width="30" height="46" rx="3" />
          <rect x="548" y="470" width="30" height="46" rx="3" />
          <rect x="632" y="440" width="26" height="40" rx="3" />
          <rect x="664" y="440" width="26" height="40" rx="3" />
          <rect x="736" y="378" width="30" height="46" rx="3" />
          <rect x="784" y="378" width="30" height="46" rx="3" />
          <rect x="736" y="456" width="30" height="46" rx="3" />
          <rect x="784" y="456" width="30" height="46" rx="3" />
          <rect x="856" y="432" width="30" height="44" rx="3" />
          <rect x="902" y="432" width="30" height="44" rx="3" />
        </g>
      </g>

      {/* birds — wavy flight + independent wing flap (login only) */}
      <g stroke="#5a4a3a" strokeWidth="2" fill="none" strokeLinecap="round">
        <Bird transform="translate(95,220)" flightClass="ts-bird-a" />
        <Bird transform="translate(150,255) scale(0.82)" flightClass="ts-bird-b" />
        <Bird transform="translate(62,188) scale(0.7)" flightClass="ts-bird-c" />
      </g>

      {/* foreground cobble wash */}
      <rect x="0" y="632" width="1000" height="88" fill="#cbb596" opacity="0.55" filter={url('wc')} />
      <rect x="0" y="632" width="1000" height="12" fill="#8a7457" opacity="0.35" />

      {/* festive bunting swags */}
      <g stroke="#5a4a3a" strokeWidth="1.8" fill="none" opacity="0.55" filter={url('ink')}>
        <path d="M150 300 Q310 358 470 300" />
        <path d="M470 300 Q650 358 830 300" />
      </g>
      <g filter={url('ink')} opacity="0.92">
        <polygon points="206,319 222,319 214,339" fill="#c96f4a" />
        <polygon points="270,329 286,329 278,349" fill="#e0b25e" />
        <polygon points="302,330 318,330 310,350" fill="#6f9a86" />
        <polygon points="334,329 350,329 342,349" fill="#5e88a6" />
        <polygon points="398,319 414,319 406,339" fill="#d9a79f" />
        <polygon points="534,319 550,319 542,339" fill="#e0b25e" />
        <polygon points="606,329 622,329 614,349" fill="#c96f4a" />
        <polygon points="642,330 658,330 650,350" fill="#5e88a6" />
        <polygon points="678,329 694,329 686,349" fill="#6f9a86" />
        <polygon points="750,319 766,319 758,339" fill="#d9a79f" />
      </g>

      {/* church clock */}
      <g filter={url('ink')}>
        <circle
          cx="412"
          cy="348"
          r="16"
          fill="#fdf3d8"
          stroke="#4a3b2f"
          strokeWidth="1.7"
          strokeOpacity="0.6"
        />
        <line
          x1="412"
          y1="348"
          x2="412"
          y2="338"
          stroke="#4a3b2f"
          strokeWidth="1.5"
          strokeOpacity="0.7"
          strokeLinecap="round"
        />
        <line
          x1="412"
          y1="348"
          x2="420"
          y2="351"
          stroke="#4a3b2f"
          strokeWidth="1.5"
          strokeOpacity="0.7"
          strokeLinecap="round"
        />
      </g>

      {/* chimney + smoke */}
      <g filter={url('ink')}>
        <rect
          x="234"
          y="290"
          width="15"
          height="24"
          fill="#b5654a"
          stroke="#4a3b2f"
          strokeWidth="1.3"
          strokeOpacity="0.5"
        />
        <path
          d="M242 288 q-11 -12 2 -22 q11 -8 0 -20"
          fill="none"
          stroke="#c3b6a6"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.55"
        />
      </g>

      {/* soft cross-hatch shading on right edges */}
      <g stroke="#4a3b2f" strokeWidth="1.1" strokeOpacity="0.13" filter={url('ink')}>
        <line x1="250" y1="360" x2="250" y2="620" />
        <line x1="256" y1="360" x2="256" y2="620" />
        <line x1="596" y1="430" x2="596" y2="620" />
        <line x1="602" y1="430" x2="602" y2="620" />
        <line x1="816" y1="372" x2="816" y2="620" />
        <line x1="822" y1="372" x2="822" y2="620" />
      </g>

      {/* doors */}
      <g filter={url('ink')} stroke="#4a3b2f" strokeWidth="1.5" strokeOpacity="0.55">
        <path d="M80 640 v-38 a14 14 0 0 1 28 0 v38 z" fill="#6d8f6a" />
        <path d="M196 640 v-40 a15 15 0 0 1 30 0 v40 z" fill="#8a5a3c" />
        <path d="M292 640 v-32 a12 12 0 0 1 24 0 v32 z" fill="#6f9a86" />
        <path d="M400 640 v-48 a16 16 0 0 1 32 0 v48 z" fill="#7a4f34" />
        <path d="M524 640 v-42 a16 16 0 0 1 32 0 v42 z" fill="#5e88a6" />
        <path d="M646 640 v-34 a12 12 0 0 1 24 0 v34 z" fill="#a86f68" />
        <path d="M756 640 v-40 a15 15 0 0 1 30 0 v40 z" fill="#c98a3c" />
        <path d="M878 640 v-38 a14 14 0 0 1 28 0 v38 z" fill="#b5654a" />
      </g>
      {/* door knobs */}
      <g fill="#3b3229" fillOpacity="0.5" filter={url('ink')}>
        <circle cx="101" cy="622" r="2.2" />
        <circle cx="219" cy="620" r="2.3" />
        <circle cx="309" cy="623" r="2" />
        <circle cx="425" cy="619" r="2.4" />
        <circle cx="547" cy="620" r="2.3" />
        <circle cx="663" cy="623" r="2" />
        <circle cx="779" cy="620" r="2.3" />
        <circle cx="899" cy="622" r="2.2" />
      </g>

      <rect x="0" y="632" width="1000" height="88" fill="#cbb596" opacity="0.5" filter={url('wc')} />

      {/* little tree, left */}
      <g filter={url('wc')}>
        <rect x="24" y="600" width="9" height="42" fill="#8a6a4a" />
        <circle cx="28" cy="588" r="33" fill="#8ba888" opacity="0.9" />
        <circle cx="10" cy="600" r="21" fill="#799a79" opacity="0.85" />
        <circle cx="46" cy="602" r="21" fill="#9cb995" opacity="0.85" />
      </g>

      {/* lamppost */}
      <g
        filter={url('ink')}
        stroke="#3b3229"
        strokeOpacity="0.68"
        strokeWidth="2.3"
        fill="none"
        strokeLinecap="round"
      >
        <line x1="452" y1="642" x2="452" y2="560" />
        <path d="M452 564 h18" />
        <rect x="463" y="552" width="14" height="16" rx="3" fill="#f6e2b0" fillOpacity="0.85" />
      </g>

      {/* cobblestone street */}
      <rect x="0" y="632" width="1000" height="6" fill="#d8c8a8" opacity="0.5" />
      <g stroke="#8a7457" strokeOpacity="0.4" strokeWidth="1" filter={url('ink')}>
        {cobbleRow(656, 11, 6, 33, -12)}
        {cobbleRow(675, 13, 7, 39, 8)}
        {cobbleRow(697, 16, 8, 47, -12)}
      </g>

      {/* paper grain */}
      <rect
        x="0"
        y="0"
        width="1000"
        height="720"
        filter={url('grain')}
        opacity="0.06"
        style={{ mixBlendMode: 'multiply' }}
      />
    </svg>
  );
}

/**
 * Small skyline silhouette for decorative card footers (never animated).
 * `ink` is the wash color — defaults to a faint ink suitable for light cards.
 */
export function TownSilhouette({ ink = 'rgb(59 50 41 / 0.08)' }: { ink?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const filterId = `sil-${uid}-wc`;

  return (
    <svg
      className="town-silhouette"
      viewBox="0 0 420 150"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={filterId} x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02 0.025"
            numOctaves="2"
            seed="9"
            result="n"
          />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="6" />
        </filter>
      </defs>
      <g fill={ink} filter={`url(#${filterId})`}>
        <rect x="10" y="80" width="46" height="70" />
        <polygon points="4,82 33,52 62,82" />
        <rect x="58" y="60" width="42" height="90" />
        <polygon points="52,62 79,30 106,62" />
        <rect x="104" y="92" width="34" height="58" />
        <polygon points="98,94 121,66 144,94" />
        <rect x="142" y="44" width="40" height="106" />
        <polygon points="136,46 162,6 188,46" />
        <rect x="186" y="72" width="48" height="78" />
        <polygon points="180,74 210,44 240,74" />
        <rect x="238" y="88" width="36" height="62" />
        <polygon points="232,90 256,62 280,90" />
        <rect x="278" y="66" width="44" height="84" />
        <polygon points="272,68 300,36 328,68" />
        <rect x="326" y="90" width="40" height="60" />
        <polygon points="320,92 346,64 372,92" />
        <rect x="368" y="74" width="44" height="76" />
        <polygon points="362,76 390,46 418,76" />
      </g>
    </svg>
  );
}

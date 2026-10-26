import { useId } from 'react';
export function VectorAvatar({mouthOpen = 0, blinking = false}: {mouthOpen?:number;blinking?:boolean}) { const instance = useId().replace(/:/g, ''); return (
          <svg viewBox="0 0 400 550" width="100%" height="100%">
            <defs>
              <linearGradient id={instance + 'hairGrad'} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#7e22ce" />
              </linearGradient>
              <linearGradient id={instance + 'skinGrad'} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#fff1eb" />
                <stop offset="100%" stopColor="#fed7aa" />
              </linearGradient>
              <linearGradient id={instance + 'clothGrad'} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#312e81" />
                <stop offset="100%" stopColor="#1e1b4b" />
              </linearGradient>
            </defs>

            <path d="M120 400 Q200 420 280 400 L320 550 L80 550 Z" fill={`url(#${instance}clothGrad)`} />
            <polygon points="200,430 170,400 230,400" fill="#a855f7" />

            <rect x="180" y="340" width="40" height="70" fill={`url(#${instance}skinGrad)`} rx="10" />
            <ellipse cx="200" cy="270" rx="85" ry="95" fill={`url(#${instance}skinGrad)`} />

            <ellipse cx="145" cy="285" rx="14" ry="7" fill="#fda4af" opacity="0.6" />
            <ellipse cx="255" cy="285" rx="14" ry="7" fill="#fda4af" opacity="0.6" />

            {blinking ? (
              <>
                <path d="M140 255 Q160 265 175 255" stroke="#3b0764" strokeWidth="4" strokeLinecap="round" fill="none" />
                <path d="M225 255 Q240 265 260 255" stroke="#3b0764" strokeWidth="4" strokeLinecap="round" fill="none" />
              </>
            ) : (
              <>
                <ellipse cx="155" cy="250" rx="16" ry="22" fill="#581c87" />
                <ellipse cx="155" cy="254" rx="11" ry="16" fill="#a855f7" />
                <circle cx="150" cy="244" r="5" fill="#ffffff" />
                <circle cx="158" cy="256" r="2.5" fill="#ffffff" />

                <ellipse cx="245" cy="250" rx="16" ry="22" fill="#581c87" />
                <ellipse cx="245" cy="254" rx="11" ry="16" fill="#a855f7" />
                <circle cx="240" cy="244" r="5" fill="#ffffff" />
                <circle cx="248" cy="256" r="2.5" fill="#ffffff" />
              </>
            )}

            <path d="M138 220 Q155 210 172 222" stroke="#6b21a8" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <path d="M228 222 Q245 210 262 220" stroke="#6b21a8" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <circle cx="200" cy="280" r="2" fill="#d97706" opacity="0.4" />

            {mouthOpen > 0.08 ? (
              <ellipse
                cx="200"
                cy={310 + mouthOpen * 4}
                rx={12 + mouthOpen * 14}
                ry={4 + mouthOpen * 18}
                fill="#be123c"
              />
            ) : (
              <path d="M190 312 Q200 317 210 312" stroke="#be123c" strokeWidth="3" strokeLinecap="round" fill="none" />
            )}

            <path d="M110 230 C120 160 160 140 200 140 C240 140 280 160 290 230 C280 200 250 180 230 200 C210 180 190 180 170 200 C150 180 120 200 110 230 Z" fill={`url(#${instance}hairGrad)`} />
            <path d="M115 220 C100 270 95 340 120 380 C110 320 125 260 135 230 Z" fill={`url(#${instance}hairGrad)`} />
            <path d="M285 220 C300 270 305 340 280 380 C290 320 275 260 265 230 Z" fill={`url(#${instance}hairGrad)`} />
          </svg>
); }

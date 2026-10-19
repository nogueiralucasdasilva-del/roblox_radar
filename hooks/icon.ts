// Vector redraw of Lucas's Roblox Radar icon: a white square spiral on orange, cut by a yellow sweep.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs>
<linearGradient id="sweep" x1="0" y1="1" x2="1" y2="0">
<stop offset="0" stop-color="#FF6A00"/>
<stop offset="0.55" stop-color="#FFC21A"/>
<stop offset="1" stop-color="#FFB050"/>
</linearGradient>
<clipPath id="tile"><rect width="100" height="100" rx="18"/></clipPath>
</defs>
<g clip-path="url(#tile)">
<rect width="100" height="100" fill="#FA6A00"/>
<g transform="rotate(15 50 50) translate(50 52) scale(0.84) translate(-50 -50)" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linejoin="miter">
<polyline points="6,98 6,6 94,6 94,94 27,94 27,27 73,27 73,73 48,73 48,50"/>
</g>
<polygon points="78,0 100,0 100,31 49,51" fill="url(#sweep)"/>
</g>
</svg>`

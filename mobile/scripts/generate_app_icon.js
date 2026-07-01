// Convert the ReLoop favicon SVG to PNG icons used by flutter_launcher_icons.
// Generates:
//   assets/icon/app_icon.png            (1024x1024, with green background)
//   assets/icon/app_icon_foreground.png (1024x1024, transparent background, scaled to safe zone)
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const svgPath = path.resolve(__dirname, '..', '..', 'app', 'icon.svg');
const outDir = path.resolve(__dirname, '..', 'assets', 'icon');
fs.mkdirSync(outDir, { recursive: true });

const svg = fs.readFileSync(svgPath, 'utf8');

// 1. App icon 1024x1024 dengan background putih. Logo ReLoop berwarna
// hijau, jadi background putih dipilih agar logo tetap kontras & jelas.
const resvgIcon = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  background: '#FFFFFF',
});
fs.writeFileSync(path.join(outDir, 'app_icon.png'), resvgIcon.render().asPng());
console.log(`OK app_icon.png (1024x1024 with #FFFFFF background)`);

// 2. Adaptive icon foreground 1024x1024. Logo ditransformasi via viewBox agar
// pas di safe zone (66% dari total) lalu di-render ulang.
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(174 174) scale(0.676)">
    <svg width="426" height="401" viewBox="0 0 426 401" xmlns="http://www.w3.org/2000/svg">
      ${svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}
    </svg>
  </g>
</svg>`;

const resvgFg = new Resvg(foregroundSvg, {
  fitTo: { mode: 'width', value: 1024 },
  background: 'rgba(0,0,0,0)',
});
fs.writeFileSync(
  path.join(outDir, 'app_icon_foreground.png'),
  resvgFg.render().asPng(),
);
console.log(`OK app_icon_foreground.png (1024x1024 transparent, safe zone)`);

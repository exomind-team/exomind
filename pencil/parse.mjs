import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync('pencil/eventlog-ui-design.pen', 'utf8'));

function extractDesign(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const props = [];
  if (node.fill) props.push('fill:' + JSON.stringify(node.fill));
  if (node.stroke) props.push('stroke:' + JSON.stringify(node.stroke).slice(0, 60));
  if (node.cornerRadius) props.push('r:' + node.cornerRadius);
  if (node.padding !== undefined) props.push('p:' + JSON.stringify(node.padding));
  if (node.gap !== undefined) props.push('gap:' + node.gap);
  if (node.layout) props.push('layout:' + node.layout);
  if (node.alignItems) props.push('align:' + node.alignItems);
  if (node.justifyContent) props.push('justify:' + node.justifyContent);
  if (node.opacity !== undefined) props.push('opacity:' + node.opacity);
  if (node.type === 'text') {
    props.push('fs:' + node.fontSize + ' fw:' + node.fontWeight + ' color:' + node.fill);
    props.push('content:' + JSON.stringify(node.content || '').slice(0, 50));
  }
  if (node.type === 'icon_font') props.push('icon:' + node.iconFontName + ' size:' + node.width);

  const size = node.width && node.height ? node.width + 'x' + node.height : '';
  console.log(indent + '[' + node.type + '] ' + (node.name || '') + ' ' + size + ' | ' + props.join(', '));

  if (node.children) node.children.forEach(c => extractDesign(c, depth + 1));
}

const screens = [6, 11, 12, 14];
screens.forEach(i => {
  console.log('\n=== ' + data.children[i].name + ' ===');
  extractDesign(data.children[i]);
});

import { existsSync,lstatSync,readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BetaGeneratedChange {path:string;before:string|Buffer|null;after:string|Buffer}
export function sameGeneratedBytes(left:string|Buffer|null,right:string|Buffer|null):boolean {
  if(left===null||right===null)return left===right;
  const leftBytes=typeof left==='string'?Buffer.from(left,'utf8'):left;
  const rightBytes=typeof right==='string'?Buffer.from(right,'utf8'):right;
  return leftBytes.equals(rightBytes);
}
function checked(root:string,parts:string[],allowMissing:boolean):string {
  let path=root;
  for(const[index,part]of parts.entries()){
    path=join(path,part);
    let metadata;try{metadata=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&allowMissing)continue;throw new Error('Canonical Android branding resource is missing');}
    if(metadata.isSymbolicLink()||(index===parts.length-1?!metadata.isFile():!metadata.isDirectory()))throw new Error('Android branding paths must be ordinary project files');
  }
  return path;
}
/** Plan only. Qualification of the Beta package precedes the shared writer. */
export function planBetaAndroidBranding(root:string):BetaGeneratedChange[] {
  const source=['src-tauri','icons','android'],target=['src-tauri','gen','android','app','src','main','res'];
  const changes:BetaGeneratedChange[]=[];
  const plan=(parts:string[],after:Buffer)=>{
    const path=checked(root,[...target,...parts],true),before=existsSync(path)?readFileSync(path):null;
    if(!sameGeneratedBytes(before,after))changes.push({path,before,after});
  };
  for(const density of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi']){
    for(const name of ['ic_launcher.png','ic_launcher_round.png','ic_launcher_foreground.png']){
      const parts=[`mipmap-${density}`,name],bytes=readFileSync(checked(root,[...source,...parts],false));
      if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Canonical Android icon must be a PNG');
      plan(parts,bytes);
    }
  }
  const background=['values','ic_launcher_background.xml'];plan(background,readFileSync(checked(root,[...source,...background],false)));
  const adaptive=readFileSync(checked(root,[...source,'mipmap-anydpi-v26','ic_launcher.xml'],false));
  if(!adaptive.toString('utf8').includes('@mipmap/ic_launcher_foreground')||!adaptive.toString('utf8').includes('@color/ic_launcher_background'))throw new Error('Canonical adaptive icon must reference the brand foreground/background');
  plan(['mipmap-anydpi-v26','ic_launcher.xml'],adaptive);
  plan(['mipmap-anydpi-v26','ic_launcher_round.xml'],adaptive);
  // A stale API-qualified template must not override a correct lower API icon.
  // Preserve the approved Alpha pack; do not invent a monochrome logo.
  for(const name of ['ic_launcher.xml','ic_launcher_round.xml'])if(existsSync(join(root,...target,'mipmap-anydpi-v33',name)))plan(['mipmap-anydpi-v33',name],adaptive);
  return changes;
}
export function ensureBetaApplicationIcons(manifest:string):string {
  const applications=[...manifest.matchAll(/<application\b[^>]*>/g)];if(applications.length!==1)throw new Error('Expected one Beta application for icon binding');
  let tag=applications[0][0];
  for(const[name,value]of [['android:icon','@mipmap/ic_launcher'],['android:roundIcon','@mipmap/ic_launcher_round']]){
    const pattern=new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`,'g');
    const count=[...tag.matchAll(pattern)].length;if(count>1)throw new Error('Duplicate Android application icon attribute');
    tag=count?tag.replace(pattern,` ${name}="${value}"`):tag.replace(/>$/,` ${name}="${value}">`);
  }
  return manifest.replace(applications[0][0],tag);
}
